export type ViewKey =
  | "dashboard"
  | "transactions"
  | "trials"
  | "ctv"
  | "students"
  | "groups"
  | "jobs"
  | "settings";

export type EnrollmentType = "paid" | "trial";
export type TrialResult = "dang_thu" | "da_dang_ky" | "khong_dang_ky";
export type PaymentStatus = "pending" | "received";
export type JobStatus = "queued" | "running" | "done" | "failed" | "needs_session";
export type JobType = "add_member" | "remove_member" | "update_role" | "verify_session";
export type GroupRole = "owner" | "manager" | "member";

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
  studentGmail?: string;
  status: JobStatus;
  attempts: number;
  error?: string;
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
  jobs: GroupJob[];
  settings: Settings;
}
