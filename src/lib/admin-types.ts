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
