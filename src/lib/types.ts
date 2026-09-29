// UI rút gọn: chỉ còn 4 màn chính. "students" là workspace gộp (đăng ký chính
// thức, học thử, danh sách HV, quản lý theo nhóm) qua các tab con.
export type ViewKey = "students" | "cashflow" | "ctv" | "settings";

export type EnrollmentType = "paid" | "trial";
export type TrialResult = "dang_thu" | "da_dang_ky" | "khong_dang_ky";
export type PaymentStatus = "pending" | "received";
export type JobStatus = "queued" | "running" | "done" | "failed" | "needs_session";
export type JobType =
  | "add_member"
  | "remove_member"
  | "update_role"
  | "update_trial_status"
  | "verify_session";
export type GroupRole = "owner" | "manager" | "member";
export type ExpenseCategory =
  | "material"
  | "system"
  | "marketing"
  | "salary"
  | "office"
  | "other";

export interface Ctv {
  id: string;
  code: string;
  name: string;
  email: string;
  commissionRate: number;
}

export interface Student {
  id: string;
  gmail: string;
  name: string;
  phone?: string;
}

export interface CourseGroup {
  id: string;
  name: string;
  groupEmail: string;
  subject: string;
  teacher: string;
  kind: "trial" | "paid" | "combo";
  priceHint: number;
  // Số thành viên thật lấy từ Admin SDK (directMembersCount). Có thể chưa biết.
  directMembersCount?: number;
}

export interface Enrollment {
  id: string;
  type: EnrollmentType;
  date: string;
  ctvId: string;
  studentId: string;
  groupId: string;
  courseType: string;
  tuition: number;
  commissionRateSnapshot: number;
  ownerShare: number;
  paymentStatus: PaymentStatus;
  paymentReceivedDate?: string;
  trialResult?: TrialResult;
  trialEndDate?: string;
  note?: string;
  // Thời điểm học viên bị gỡ khỏi Google Group. Giữ lại đăng ký (đặc biệt là
  // khoản đã thu) để dòng tiền / công nợ không mất, thay vì xóa hẳn bản ghi.
  removedAt?: string;
}

export interface Expense {
  id: string;
  date: string;
  category: ExpenseCategory;
  amount: number;
  note?: string;
  createdAt?: string;
}

export interface GroupMember {
  id: string;
  groupId: string;
  email: string;
  name?: string;
  role: GroupRole;
  joinDate: string;
}

export interface GroupJob {
  id: string;
  type: JobType;
  groupId?: string;
  groupEmail?: string;
  studentGmail?: string;
  status: JobStatus;
  attempts: number;
  error?: string;
  detail?: string;
  actorEmail?: string;
  actorName?: string;
  actorRole?: "admin" | "ctv";
  origin?: "automation" | "ctv_activity";
  createdAt: string;
  finishedAt?: string;
}

export interface Settings {
  defaultCommissionRate: number;
  minDelay: number;
  maxDelay: number;
  allowlistEmails: string[];
}

export interface AppState {
  ctvs: Ctv[];
  students: Student[];
  groups: CourseGroup[];
  groupMembers: GroupMember[];
  enrollments: Enrollment[];
  expenses: Expense[];
  jobs: GroupJob[];
  settings: Settings;
}
