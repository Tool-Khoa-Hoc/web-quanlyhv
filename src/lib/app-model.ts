// Helper thuần (không JSX) cho CourseManagerApp: khóa lưu trữ localStorage,
// chuẩn hóa state đã lưu, dựng model dẫn xuất cho UI, và các hàm truy vấn/tiện ích.
// Tách khỏi component để file component gọn và dễ test.

import {
  byId,
  debtByCtv,
  makeId,
  metrics,
  paidEnrollments,
  trendSeries,
  trialEnrollments,
} from "./calculations";
import { seedState } from "./seed-data";
import type { AppState, Enrollment, GroupJob } from "./types";

export const STORAGE_KEY = "quan-ly-khoa-hoc-state-v2";
export const LEGACY_STORAGE_KEYS = ["quan-ly-khoa-hoc-state-v1"];

export function createJob(
  type: GroupJob["type"],
  groupId?: string,
  studentGmail?: string,
): GroupJob {
  return {
    id: makeId("job"),
    type,
    groupId,
    studentGmail,
    status: "queued",
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
}

export function jobGroupLabel(state: AppState, job: GroupJob, fallback = "-") {
  const directGroup = job.groupId
    ? state.groups.find((group) => group.id === job.groupId)
    : undefined;
  if (directGroup) return directGroup.name;

  const gmail = job.studentGmail?.trim().toLowerCase();
  if (!gmail) return fallback;

  const studentIds = new Set(
    state.students
      .filter((student) => student.gmail.trim().toLowerCase() === gmail)
      .map((student) => student.id),
  );
  if (!studentIds.size) return fallback;

  const labels = state.enrollments
    .filter((enrollment) => studentIds.has(enrollment.studentId))
    .filter((enrollment) => !job.groupId || enrollment.groupId === job.groupId)
    .map((enrollment) => {
      const group = state.groups.find((item) => item.id === enrollment.groupId);
      return group?.name || enrollment.courseType;
    })
    .filter((label, index, all) => label && all.indexOf(label) === index);

  return labels.length ? labels.join(", ") : fallback;
}

export function addDaysISO(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function matchesQuery(enrollment: Enrollment, query: string, state: AppState) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const student = state.students.find((item) => item.id === enrollment.studentId);
  const ctv = state.ctvs.find((item) => item.id === enrollment.ctvId);
  const group = state.groups.find((item) => item.id === enrollment.groupId);
  const haystack = [
    student?.gmail,
    student?.name,
    ctv?.name,
    ctv?.code,
    group?.name,
    group?.groupEmail,
    enrollment.courseType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalized);
}

export function normalizePersistedState(parsed: AppState): AppState {
  const groups = (parsed.groups ?? []).filter((group) => group.id && group.groupEmail);
  const groupIds = new Set(groups.map((group) => group.id));

  return {
    ...seedState,
    ...parsed,
    settings: {
      ...seedState.settings,
      ...parsed.settings,
    },
    groups,
    expenses: parsed.expenses ?? [],
    groupMembers: (parsed.groupMembers ?? []).filter((member) => groupIds.has(member.groupId)),
    jobs: (parsed.jobs ?? []).filter((job) => !job.groupId || groupIds.has(job.groupId)),
  };
}

export function buildModelShape(state: AppState) {
  return {
    ctvMap: byId(state.ctvs),
    studentMap: byId(state.students),
    groupMap: byId(state.groups),
    summary: metrics(state),
    ctvDebt: debtByCtv(state),
    paid: paidEnrollments(state),
    trials: trialEnrollments(state),
    trend: trendSeries(state),
  };
}

export type ModelShape = ReturnType<typeof buildModelShape>;
