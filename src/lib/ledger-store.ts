import "server-only";

import { getRedis, isKvConfigured } from "./kv";
import type { Ctv, Enrollment, Expense, GroupJob, Settings, Student } from "./types";

// ===== Sổ cái dùng chung (Vercel KV / Upstash Redis) =====
// Lưu phần dữ liệu nghiệp vụ của admin (CTV, học viên, giao dịch, chi phí,
// jobs, thông số) để đồng bộ giữa nhiều thiết bị. Groups/groupMembers không ở
// đây vì được lấy trực tiếp từ Google Admin SDK.
//
// Toàn bộ lưu trong 1 key JSON. Mỗi lần ghi tăng `rev` để client phát hiện đụng độ.

const LEDGER_KEY = "ledger:v1";

export interface LedgerData {
  ctvs: Ctv[];
  students: Student[];
  enrollments: Enrollment[];
  expenses: Expense[];
  jobs: GroupJob[];
  settings: Settings;
  rev: number;
  updatedAt: string;
}

export type LedgerPayload = Omit<LedgerData, "rev" | "updatedAt">;

export function isLedgerConfigured(): boolean {
  return isKvConfigured();
}

function parseLedger(raw: string | null | undefined): LedgerData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Omit<LedgerData, "expenses"> & { expenses?: Expense[] };
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return {
      ...parsed,
      // Ledger v1 cũ không có chi phí; coi như danh sách rỗng khi đọc lại.
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
    };
  } catch {
    return null;
  }
}

/** Đọc sổ cái hiện tại (null nếu chưa từng ghi). */
export async function readLedger(): Promise<LedgerData | null> {
  const redis = getRedis();
  return parseLedger(await redis.get<string>(LEDGER_KEY));
}

export interface WriteResult {
  ok: boolean;
  ledger: LedgerData;
}

/**
 * Ghi sổ cái với kiểm tra đụng độ lạc quan.
 * - baseRev khớp rev hiện tại (hoặc chưa có sổ) → ghi, tăng rev, trả ok=true.
 * - baseRev cũ hơn → từ chối (ok=false) và trả về bản server mới nhất để client hợp nhất.
 * Dùng Lua script để atomic (tránh lost-update khi 2 admin ghi cùng lúc).
 */
export async function writeLedger(
  payload: LedgerPayload,
  baseRev: number,
): Promise<WriteResult> {
  const redis = getRedis();
  const now = new Date().toISOString();

  // Thử atomic qua Lua trước. Nếu Upstash không hỗ trợ eval thì fallback read-then-write.
  try {
    const lua = `
      local cur = redis.call('GET', KEYS[1])
      local curRev = 0
      if cur then
        local ok, obj = pcall(cjson.decode, cur)
        if ok and obj and obj.rev then curRev = tonumber(obj.rev) or 0 end
      end
      if cur and tonumber(ARGV[1]) ~= curRev then
        return cur
      end
      local nextObj = cjson.decode(ARGV[2])
      nextObj.rev = curRev + 1
      nextObj.updatedAt = ARGV[3]
      local nextJson = cjson.encode(nextObj)
      redis.call('SET', KEYS[1], nextJson)
      return nextJson
    `;
    const basePayload = JSON.stringify({
      ctvs: payload.ctvs,
      students: payload.students,
      enrollments: payload.enrollments,
      expenses: payload.expenses,
      jobs: payload.jobs,
      settings: payload.settings,
    });
    // @upstash/redis eval: (script, keys, args)
    const raw = await (redis as unknown as { eval: (s: string, k: string[], a: string[]) => Promise<unknown> }).eval(lua, [LEDGER_KEY], [String(baseRev), basePayload, now]);
    const json = typeof raw === "string" ? raw : String(raw ?? "");
    const parsed = parseLedger(json);
    if (parsed) {
      // Nếu Lua vừa ghi thì updatedAt === now (do server set). Ngược lại là bản cũ -> conflict.
      // Đơn giản: đọc lại để so sánh? Ở đây dùng heuristic: nếu parsed.updatedAt === now thì là ghi mới.
      if (parsed.updatedAt === now) return { ok: true, ledger: parsed };
      return { ok: false, ledger: parsed };
    }
  } catch {
    // fallback bên dưới
  }

  const current = await readLedger();
  const currentRev = current?.rev ?? 0;
  if (current && baseRev !== currentRev) {
    return { ok: false, ledger: current };
  }
  const next: LedgerData = {
    ctvs: payload.ctvs,
    students: payload.students,
    enrollments: payload.enrollments,
    expenses: payload.expenses,
    jobs: payload.jobs,
    settings: payload.settings,
    rev: currentRev + 1,
    updatedAt: now,
  };
  await redis.set(LEDGER_KEY, JSON.stringify(next));
  return { ok: true, ledger: next };
}
