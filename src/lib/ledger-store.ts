import "server-only";

import { getRedis, isKvConfigured } from "./kv";
import type { Ctv, Enrollment, Settings, Student } from "./types";

// ===== Sổ cái dùng chung (Vercel KV / Upstash Redis) =====
// Lưu phần dữ liệu nghiệp vụ của admin (CTV, học viên, giao dịch, thông số) để
// đồng bộ giữa nhiều thiết bị. Groups/groupMembers/jobs KHÔNG ở đây vì lấy trực
// tiếp từ Google Admin SDK / hàng đợi cục bộ.
//
// Toàn bộ lưu trong 1 key JSON. Mỗi lần ghi tăng `rev` để client phát hiện đụng độ.

const LEDGER_KEY = "ledger:v1";

export interface LedgerData {
  ctvs: Ctv[];
  students: Student[];
  enrollments: Enrollment[];
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
    return JSON.parse(raw) as LedgerData;
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
 */
export async function writeLedger(
  payload: LedgerPayload,
  baseRev: number,
): Promise<WriteResult> {
  const redis = getRedis();
  const current = await readLedger();
  const currentRev = current?.rev ?? 0;
  if (current && baseRev !== currentRev) {
    return { ok: false, ledger: current };
  }
  const next: LedgerData = {
    ctvs: payload.ctvs,
    students: payload.students,
    enrollments: payload.enrollments,
    settings: payload.settings,
    rev: currentRev + 1,
    updatedAt: new Date().toISOString(),
  };
  await redis.set(LEDGER_KEY, JSON.stringify(next));
  return { ok: true, ledger: next };
}
