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

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function parseLedger(raw: string | null | undefined): LedgerData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LedgerData>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    // Mọi danh sách phải là array khi trả về client. Ledger v1 cũ không có
    // `expenses`, và bản ghi do script Lua cũ tạo có thể lưu mảng rỗng thành
    // `{}` — để nguyên thì client `.filter`/`.map` sẽ nổ và mất cả bảng.
    return {
      ...parsed,
      ctvs: asArray<Ctv>(parsed.ctvs),
      students: asArray<Student>(parsed.students),
      enrollments: asArray<Enrollment>(parsed.enrollments),
      expenses: asArray<Expense>(parsed.expenses),
      jobs: asArray<GroupJob>(parsed.jobs),
      settings: (parsed.settings ?? {}) as Settings,
      rev: Number(parsed.rev) || 0,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
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
  //
  // Lua CHỈ đọc rev rồi SET nguyên chuỗi JSON đã dựng ở JS. Trước đây script
  // `cjson.decode` payload rồi `cjson.encode` lại — cjson biến mảng rỗng `[]`
  // thành object `{}` (và không giữ thứ tự khóa), nên sổ cái ghi ra có thể sai
  // kiểu và client đọc lại bị lỗi/mất danh sách.
  const nextRev = baseRev + 1;
  const nextJson = JSON.stringify({
    ctvs: payload.ctvs,
    students: payload.students,
    enrollments: payload.enrollments,
    expenses: payload.expenses,
    jobs: payload.jobs,
    settings: payload.settings,
    rev: nextRev,
    updatedAt: now,
  });

  try {
    const lua = `
      local cur = redis.call('GET', KEYS[1])
      local curRev = 0
      if cur then
        local ok, obj = pcall(cjson.decode, cur)
        if ok and type(obj) == 'table' and obj.rev then curRev = tonumber(obj.rev) or 0 end
      end
      if cur and tonumber(ARGV[1]) ~= curRev then
        return cur
      end
      redis.call('SET', KEYS[1], ARGV[2])
      return 'OK'
    `;
    // @upstash/redis eval: (script, keys, args)
    const raw = await (
      redis as unknown as { eval: (s: string, k: string[], a: string[]) => Promise<unknown> }
    ).eval(lua, [LEDGER_KEY], [String(baseRev), nextJson]);
    const json = typeof raw === "string" ? raw : String(raw ?? "");
    // 'OK' = vừa ghi; bất cứ gì khác là bản server hiện tại → đụng độ.
    if (json === "OK") {
      return { ok: true, ledger: JSON.parse(nextJson) as LedgerData };
    }
    const parsed = parseLedger(json);
    if (parsed) return { ok: false, ledger: parsed };
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
