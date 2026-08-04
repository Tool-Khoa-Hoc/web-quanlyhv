import "server-only";

import { randomUUID } from "node:crypto";

import type { AppSession } from "./auth";
import { getRedis, isKvConfigured } from "./kv";
import type { GroupJob, JobStatus, JobType } from "./types";

const CTV_ACTIVITY_KEY = "ctv-activity:v1";
const MAX_ACTIVITY_ROWS = 500;

export interface CtvActivityInput {
  type: JobType;
  groupEmail: string;
  studentGmail?: string;
  status: Extract<JobStatus, "done" | "failed">;
  error?: string;
  detail?: string;
}

/**
 * Ghi nhật ký thao tác của CTV theo kiểu best-effort. Lỗi kho nhật ký không được
 * làm hỏng thao tác Google Group chính mà CTV vừa thực hiện.
 */
export async function recordCtvActivity(
  session: AppSession,
  input: CtvActivityInput,
): Promise<void> {
  if (session.role !== "ctv" || !isKvConfigured()) return;

  const now = new Date().toISOString();
  const groupEmail = input.groupEmail.trim().toLowerCase();
  const job: GroupJob = {
    id: `ctv-job-${randomUUID()}`,
    type: input.type,
    groupId: groupEmail ? `grp-${groupEmail}` : undefined,
    groupEmail: groupEmail || undefined,
    studentGmail: input.studentGmail?.trim().toLowerCase() || undefined,
    status: input.status,
    attempts: 1,
    error: input.error,
    detail: input.detail,
    actorEmail: session.email.trim().toLowerCase(),
    actorName: session.name.trim(),
    actorRole: "ctv",
    origin: "ctv_activity",
    createdAt: now,
    finishedAt: now,
  };

  try {
    const redis = getRedis();
    await redis.lpush(CTV_ACTIVITY_KEY, JSON.stringify(job));
    await redis.ltrim(CTV_ACTIVITY_KEY, 0, MAX_ACTIVITY_ROWS - 1);
  } catch {
    // Nhật ký là bổ trợ quan sát; thao tác nghiệp vụ chính vẫn phải trả đúng kết quả.
  }
}

function parseActivity(value: unknown): GroupJob | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const job = parsed as GroupJob;
    if (!job.id || !job.type || !job.createdAt || job.actorRole !== "ctv") return null;
    return job;
  } catch {
    return null;
  }
}

export async function listCtvActivities(): Promise<GroupJob[]> {
  if (!isKvConfigured()) return [];
  const redis = getRedis();
  const rows = await redis.lrange<unknown[]>(CTV_ACTIVITY_KEY, 0, MAX_ACTIVITY_ROWS - 1);
  return (rows ?? [])
    .map(parseActivity)
    .filter((job): job is GroupJob => Boolean(job))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
