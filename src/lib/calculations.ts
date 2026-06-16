import type { AppState, Ctv, Enrollment, GroupJob, GroupRole, TrialResult } from "./types";

export function currency(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}

export function shortDate(value: string) {
  if (!value) return "Chưa rõ";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Chưa rõ";

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function ownerShare(tuition: number, commissionRate: number) {
  return Math.round(tuition * commissionRate);
}

export function paidEnrollments(state: AppState) {
  return state.enrollments.filter((item) => item.type === "paid");
}

export function trialEnrollments(state: AppState) {
  return state.enrollments.filter((item) => item.type === "trial");
}

export function metrics(state: AppState) {
  const paid = paidEnrollments(state);
  const trials = trialEnrollments(state);
  const expected = paid.reduce((sum, item) => sum + item.ownerShare, 0);
  const received = paid
    .filter((item) => item.paymentStatus === "received")
    .reduce((sum, item) => sum + item.ownerShare, 0);
  const debt = expected - received;
  const converted = trials.filter((item) => item.trialResult === "da_dang_ky").length;
  const conversionRate = trials.length ? Math.round((converted / trials.length) * 1000) / 10 : 0;

  return {
    expected,
    received,
    debt,
    unpaidCount: paid.filter((item) => item.paymentStatus === "pending").length,
    conversionRate,
    totalTrials: trials.length,
    converted,
  };
}

export function byId<T extends { id: string }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item]));
}

export function debtByCtv(state: AppState) {
  const paid = paidEnrollments(state);

  return state.ctvs
    .map((ctv) => {
      const rows = paid.filter((item) => item.ctvId === ctv.id);
      const expected = rows.reduce((sum, item) => sum + item.ownerShare, 0);
      const received = rows
        .filter((item) => item.paymentStatus === "received")
        .reduce((sum, item) => sum + item.ownerShare, 0);
      return {
        ctv,
        expected,
        received,
        debt: expected - received,
        pendingCount: rows.filter((item) => item.paymentStatus === "pending").length,
      };
    })
    .sort((a, b) => b.debt - a.debt);
}

export function trialLabel(result?: TrialResult) {
  switch (result) {
    case "da_dang_ky":
      return "Đã đăng ký";
    case "khong_dang_ky":
      return "Không đăng ký";
    default:
      return "Đang thử";
  }
}

export function jobLabel(job: GroupJob) {
  if (job.type === "verify_session") return "Kiểm tra Admin SDK";
  if (job.type === "remove_member") return "Xóa khỏi Google Group";
  if (job.type === "update_role") return "Đổi role thành viên";
  return "Thêm vào Google Group";
}

export function membersByGroup(state: AppState, groupId: string) {
  const rank: Record<GroupRole, number> = { owner: 0, manager: 1, member: 2 };
  return state.groupMembers
    .filter((member) => member.groupId === groupId)
    .sort((a, b) => rank[a.role] - rank[b.role] || a.email.localeCompare(b.email));
}

export function memberCount(state: AppState, groupId: string) {
  return state.groupMembers.filter((member) => member.groupId === groupId).length;
}

export function roleLabel(role: GroupRole) {
  switch (role) {
    case "owner":
      return "Chủ sở hữu";
    case "manager":
      return "Quản lý";
    default:
      return "Thành viên";
  }
}

export function statusLabel(status: GroupJob["status"]) {
  switch (status) {
    case "done":
      return "Thành công";
    case "failed":
      return "Thất bại";
    case "running":
      return "Đang chạy";
    case "needs_session":
      return "Cần cấu hình";
    default:
      return "Đang chờ";
  }
}

export function trendSeries(state: AppState) {
  const paid = paidEnrollments(state);
  const dates = Array.from(new Set(paid.map((item) => item.date))).sort();

  return dates.map((date) => {
    const rows = paid.filter((item) => item.date === date);
    const revenue = rows.reduce((sum, item) => sum + item.tuition, 0);
    const share = rows.reduce((sum, item) => sum + item.ownerShare, 0);
    return {
      date,
      revenue,
      share,
    };
  });
}

export function ctvDisplay(ctv: Ctv) {
  return `${ctv.name} (${ctv.code})`;
}

export function findOrCreateStudent(
  state: AppState,
  gmail: string,
  fallbackName?: string,
) {
  const normalized = gmail.trim().toLowerCase();
  const existing = state.students.find((student) => student.gmail.toLowerCase() === normalized);
  if (existing) return { state, studentId: existing.id };

  const newStudent = {
    id: makeId("stu"),
    gmail: normalized,
    name: fallbackName?.trim() || normalized.split("@")[0],
  };

  return {
    state: {
      ...state,
      students: [newStudent, ...state.students],
    },
    studentId: newStudent.id,
  };
}
