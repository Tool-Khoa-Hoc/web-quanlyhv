import type { GroupJob, JobStatus } from "./types";

// Lịch sử jobs tăng mãi theo mỗi thao tác (thêm/xóa học viên khỏi nhóm...) và
// được đẩy nguyên vào sổ cái dùng chung → payload phình tới mức bị server từ chối.
// Chỉ giữ job còn đang xử lý + N job đã kết thúc gần nhất.

export const MAX_FINISHED_JOBS = 300;

const ACTIVE_STATUSES: ReadonlySet<JobStatus> = new Set(["queued", "running", "needs_session"]);

function jobTime(job: GroupJob): number {
  const t = Date.parse(job?.finishedAt ?? job?.createdAt ?? "");
  return Number.isFinite(t) ? t : 0;
}

/** Giữ mọi job đang chờ/chạy + tối đa `maxFinished` job đã xong/lỗi mới nhất (giữ nguyên thứ tự). */
export function trimJobHistory(jobs: GroupJob[], maxFinished = MAX_FINISHED_JOBS): GroupJob[] {
  const finished = jobs.filter((job) => !ACTIVE_STATUSES.has(job?.status));
  if (finished.length <= maxFinished) return jobs;
  const keep = new Set(
    [...finished].sort((a, b) => jobTime(b) - jobTime(a)).slice(0, maxFinished),
  );
  return jobs.filter((job) => ACTIVE_STATUSES.has(job?.status) || keep.has(job));
}
