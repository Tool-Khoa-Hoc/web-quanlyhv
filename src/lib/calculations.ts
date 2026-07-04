import type {
  AppState,
  Ctv,
  Enrollment,
  ExpenseCategory,
  GroupJob,
  GroupRole,
  TrialResult,
} from "./types";

export type CashflowGranularity = "week" | "month";

export interface CashflowBucket {
  key: string;
  label: string;
  income: number;
  expense: number;
  net: number;
  cumulative: number;
}

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "material",
  "system",
  "marketing",
  "salary",
  "office",
  "other",
];

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function datePart(value: number) {
  return String(value).padStart(2, "0");
}

function isoWeekStart(year: number, week: number): Date {
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const mondayOffset = (januaryFourth.getUTCDay() + 6) % 7;
  const firstMonday = new Date(januaryFourth);
  firstMonday.setUTCDate(januaryFourth.getUTCDate() - mondayOffset);
  const start = new Date(firstMonday);
  start.setUTCDate(firstMonday.getUTCDate() + (week - 1) * 7);
  return start;
}

export function monthKey(iso: string): string {
  const date = parseIsoDate(iso);
  return date ? `${date.getUTCFullYear()}-${datePart(date.getUTCMonth() + 1)}` : "";
}

export function monthLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  return match ? `${match[2]}/${match[1]}` : key;
}

/** Trả khóa tuần ISO-8601; tuần bắt đầu vào Thứ Hai. */
export function weekKey(iso: string): string {
  const date = parseIsoDate(iso);
  if (!date) return "";

  const thursday = new Date(date);
  const mondayBasedDay = (date.getUTCDay() + 6) % 7;
  thursday.setUTCDate(date.getUTCDate() + 3 - mondayBasedDay);
  const weekYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  const firstMondayBasedDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - firstMondayBasedDay);
  const week =
    1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${weekYear}-W${datePart(week)}`;
}

export function weekLabel(key: string): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!match) return key;
  const start = isoWeekStart(Number(match[1]), Number(match[2]));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const label = (date: Date) => `${datePart(date.getUTCDate())}/${datePart(date.getUTCMonth() + 1)}`;
  return `${label(start)}–${label(end)}`;
}

export function expenseCategoryLabel(category: ExpenseCategory): string {
  switch (category) {
    case "material":
      return "Nguyên liệu";
    case "system":
      return "Duy trì hệ thống / phần mềm";
    case "marketing":
      return "Marketing / Quảng cáo";
    case "salary":
      return "Lương / thưởng";
    case "office":
      return "Văn phòng phẩm";
    default:
      return "Khác";
  }
}

export function cashflowSeries(
  state: AppState,
  granularity: CashflowGranularity,
): CashflowBucket[] {
  const buckets = new Map<string, { income: number; expense: number }>();
  const keyFor = granularity === "week" ? weekKey : monthKey;

  for (const enrollment of state.enrollments) {
    if (
      enrollment.type !== "paid" ||
      enrollment.paymentStatus !== "received" ||
      !enrollment.paymentReceivedDate
    ) {
      continue;
    }
    const key = keyFor(enrollment.paymentReceivedDate);
    if (!key) continue;
    const bucket = buckets.get(key) ?? { income: 0, expense: 0 };
    bucket.income += enrollment.ownerShare;
    buckets.set(key, bucket);
  }

  for (const expense of state.expenses ?? []) {
    const key = keyFor(expense.date);
    if (!key) continue;
    const bucket = buckets.get(key) ?? { income: 0, expense: 0 };
    bucket.expense += expense.amount;
    buckets.set(key, bucket);
  }

  let cumulative = 0;
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => {
      const net = values.income - values.expense;
      cumulative += net;
      return {
        key,
        label: granularity === "week" ? weekLabel(key) : monthLabel(key),
        income: values.income,
        expense: values.expense,
        net,
        cumulative,
      };
    });
}

export function financeSummary(state: AppState) {
  const income = state.enrollments
    .filter(
      (item) =>
        item.type === "paid" &&
        item.paymentStatus === "received",
    )
    .reduce((sum, item) => sum + item.ownerShare, 0);
  const categoryTotals = Object.fromEntries(
    EXPENSE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<ExpenseCategory, number>;

  let expense = 0;
  for (const item of state.expenses ?? []) {
    expense += item.amount;
    categoryTotals[item.category] += item.amount;
  }

  const byCategory = EXPENSE_CATEGORIES.map((category) => ({
    category,
    amount: categoryTotals[category],
  }));

  return { income, expense, net: income - expense, byCategory };
}

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
