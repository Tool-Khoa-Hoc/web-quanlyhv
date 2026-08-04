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
import type { AppState, CourseGroup, Enrollment, GroupJob } from "./types";

/**
 * Tìm Google Group cho một đăng ký một cách "khoan dung".
 *
 * Vì sao cần: `enrollment.groupId` được lưu trong sổ cái dùng chung, nhưng danh
 * sách nhóm lại nạp riêng từng thiết bị (localStorage / đồng bộ Google) với id
 * dạng `grp-<email>`. Nếu nhóm được tạo trong app bằng id ngẫu nhiên, hoặc đăng
 * ký được tạo trên máy khác, thì `groupId` không khớp id hiện tại → cột Google
 * Group hiển thị "Chưa gán" dù học viên thật sự đang ở trong nhóm.
 *
 * Thứ tự khớp: id trực tiếp → email suy ra từ id `grp-<email>` → courseType khớp
 * tên/email nhóm → thành viên thật (học viên đã có trong nhóm nào đã nạp).
 */
export function resolveEnrollmentGroup(
  state: AppState,
  enrollment: Pick<Enrollment, "groupId" | "courseType" | "studentId">,
): CourseGroup | undefined {
  // 1) Khớp trực tiếp theo id (trường hợp bình thường).
  const byGroupId = state.groups.find((group) => group.id === enrollment.groupId);
  if (byGroupId) return byGroupId;

  // 2) groupId dạng "grp-<email>" nhưng danh sách nhóm hiện tại dùng id khác:
  //    tách phần email và khớp theo groupEmail.
  const idEmail = enrollment.groupId?.startsWith("grp-")
    ? enrollment.groupId.slice(4).trim().toLowerCase()
    : "";
  if (idEmail.includes("@")) {
    const byIdEmail = state.groups.find(
      (group) => group.groupEmail.trim().toLowerCase() === idEmail,
    );
    if (byIdEmail) return byIdEmail;
  }

  // 3) Khớp theo courseType (lúc tạo thường lưu đúng tên nhóm hoặc email nhóm).
  const course = enrollment.courseType?.trim().toLowerCase();
  if (course) {
    const byCourse = state.groups.find(
      (group) =>
        group.name.trim().toLowerCase() === course ||
        group.groupEmail.trim().toLowerCase() === course,
    );
    if (byCourse) return byCourse;
  }

  // 4) Dựa trên thành viên thật: học viên đã là thành viên của nhóm nào (nếu đã nạp).
  const gmail = state.students
    .find((student) => student.id === enrollment.studentId)
    ?.gmail.trim()
    .toLowerCase();
  if (gmail) {
    const membership = state.groupMembers.find(
      (member) => member.email.trim().toLowerCase() === gmail,
    );
    if (membership) {
      const byMembership = state.groups.find((group) => group.id === membership.groupId);
      if (byMembership) return byMembership;
    }
  }

  return undefined;
}

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

  const recordedGroupEmail = job.groupEmail?.trim().toLowerCase();
  if (recordedGroupEmail) {
    const recordedGroup = state.groups.find(
      (group) => group.groupEmail.trim().toLowerCase() === recordedGroupEmail,
    );
    return recordedGroup?.name || job.groupEmail || fallback;
  }

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
      const group = resolveEnrollmentGroup(state, enrollment);
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
  const group = resolveEnrollmentGroup(state, enrollment);
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
