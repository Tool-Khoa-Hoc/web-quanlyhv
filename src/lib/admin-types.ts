// Kiểu dữ liệu DTO dùng chung giữa API routes (server) và client.
// KHÔNG import gì từ googleapis ở đây để file an toàn cho cả hai phía.

export type ApiGroupRole = "OWNER" | "MANAGER" | "MEMBER";

// Vai trò + phiên đăng nhập dùng chung cho client (không phụ thuộc server-only).
export type AppRole = "admin" | "ctv";

export interface ClientSession {
  email: string;
  name: string;
  role: AppRole;
}

export interface ApiGroup {
  id: string;
  email: string;
  name: string;
  description: string;
  directMembersCount: number;
}

export interface ApiMember {
  id: string;
  email: string;
  role: ApiGroupRole;
  status: string;
  type: string;
}

export type ApiAdminCredentialSource =
  | "GOOGLE_ADMIN_SA_KEY"
  | "GOOGLE_ADMIN_SA_KEY_BASE64"
  | "GOOGLE_ADMIN_SA_KEY_FILE";

export interface ApiAdminStatus {
  ok: true;
  domain: string;
  impersonateEmail: string;
  serviceAccountEmail: string;
  credentialSource: ApiAdminCredentialSource;
  sampleGroups: number;
  checkedAt: string;
}

export interface ApiError {
  error: string;
}

// Thành viên nội bộ thuộc domain Workspace (dùng cho dropdown chọn CTV).
export interface DomainMember {
  email: string;
  name?: string;
}

// Trạng thái học thử (khớp TrialResult ở types.ts).
export type TrialStatus = "dang_thu" | "da_dang_ky" | "khong_dang_ky";

// 1 dòng trong Google Sheet kho học thử. Dùng chung server (sheets.ts) lẫn client.
export interface TrialRecord {
  timestamp: string;
  groupEmail: string;
  studentEmail: string;
  studentName: string;
  trialCourse: string;
  ctvEmail: string;
  ctvName: string;
  status: string;
}
