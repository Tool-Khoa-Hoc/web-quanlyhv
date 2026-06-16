import "server-only";

import { getRedis, isKvConfigured } from "./kv";
import type { TrialRecord } from "./admin-types";

export type { TrialRecord } from "./admin-types";

// ===== Kho chung cho dữ liệu "Khóa học thử" — Vercel KV / Upstash Redis =====
// Lưu mỗi record vào 1 Redis hash field; field = "<groupEmail>|<studentEmail>".

export class TrialStoreError extends Error {}

const HASH_KEY = "trials";

export function isTrialStoreConfigured(): boolean {
  return isKvConfigured();
}

function fieldFor(groupEmail: string, studentEmail: string): string {
  return `${groupEmail.trim().toLowerCase()}|${studentEmail.trim().toLowerCase()}`;
}

function parseRecord(raw: string | null | undefined): TrialRecord | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TrialRecord;
  } catch {
    return null;
  }
}

/** Đọc toàn bộ record, mới nhất trước. */
export async function listTrialRecords(): Promise<TrialRecord[]> {
  const redis = getRedis();
  const all = await redis.hgetall<Record<string, string>>(HASH_KEY);
  if (!all) return [];
  const records: TrialRecord[] = [];
  for (const value of Object.values(all)) {
    const record = parseRecord(value);
    if (record?.studentEmail) records.push(record);
  }
  records.sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  return records;
}

/**
 * Thêm/cập nhật record theo khóa (groupEmail + studentEmail).
 * Đã có → cập nhật course/ctv/tên + timestamp, GIỮ status cũ.
 * Chưa có → tạo mới với status mặc định "dang_thu".
 */
export async function upsertTrialRecord(input: {
  timestamp: string;
  groupEmail: string;
  studentEmail: string;
  studentName: string;
  trialCourse: string;
  ctvEmail: string;
  ctvName: string;
}): Promise<TrialRecord> {
  const redis = getRedis();
  const field = fieldFor(input.groupEmail, input.studentEmail);
  const existing = parseRecord(await redis.hget<string>(HASH_KEY, field));

  const record: TrialRecord = {
    timestamp: input.timestamp,
    groupEmail: input.groupEmail,
    studentEmail: input.studentEmail,
    studentName: input.studentName || existing?.studentName || "",
    trialCourse: input.trialCourse || existing?.trialCourse || "",
    ctvEmail: input.ctvEmail || existing?.ctvEmail || "",
    ctvName: input.ctvName || existing?.ctvName || "",
    status: existing?.status || "dang_thu",
  };
  await redis.hset(HASH_KEY, { [field]: JSON.stringify(record) });
  return record;
}

/** Cập nhật trạng thái học thử của 1 record. Trả false nếu không tìm thấy. */
export async function updateTrialStatus(
  groupEmail: string,
  studentEmail: string,
  status: string,
): Promise<boolean> {
  const redis = getRedis();
  const field = fieldFor(groupEmail, studentEmail);
  const record = parseRecord(await redis.hget<string>(HASH_KEY, field));
  if (!record) return false;
  record.status = status;
  await redis.hset(HASH_KEY, { [field]: JSON.stringify(record) });
  return true;
}
