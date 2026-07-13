import "server-only";

import { readFileSync } from "node:fs";
import { google, type admin_directory_v1 } from "googleapis";
import type { ApiAdminCredentialSource } from "./admin-types";
import { getErrorMessage } from "./error-message";

// Scopes tối thiểu để đọc nhóm + thêm/xóa/sửa thành viên.
const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/admin.directory.group.member",
];

export const SHEET_HOC_DTHT_GROUP_EMAIL = "sheet-hoc-dtht@dautruonghoctap.io.vn";

export class AdminConfigError extends Error {}

export class AdminUserError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  source: ApiAdminCredentialSource;
}

function loadServiceAccountKey(): ServiceAccountKey {
  const inline = process.env.GOOGLE_ADMIN_SA_KEY?.trim();
  const base64 = process.env.GOOGLE_ADMIN_SA_KEY_BASE64?.trim();
  const filePath = process.env.GOOGLE_ADMIN_SA_KEY_FILE?.trim();

  let raw: string | undefined;
  let source: ApiAdminCredentialSource;
  if (inline) {
    raw = inline;
    source = "GOOGLE_ADMIN_SA_KEY";
  } else if (base64) {
    try {
      raw = Buffer.from(base64, "base64").toString("utf8");
      source = "GOOGLE_ADMIN_SA_KEY_BASE64";
    } catch {
      throw new AdminConfigError("GOOGLE_ADMIN_SA_KEY_BASE64 không phải base64 hợp lệ.");
    }
  } else if (filePath) {
    try {
      raw = readFileSync(filePath, "utf8");
      source = "GOOGLE_ADMIN_SA_KEY_FILE";
    } catch (error) {
      throw new AdminConfigError(
        `Không đọc được file Service Account key tại GOOGLE_ADMIN_SA_KEY_FILE (${filePath}): ${
          (error as Error).message
        }`,
      );
    }
  } else {
    throw new AdminConfigError(
      "Chưa cấu hình Service Account. Đặt GOOGLE_ADMIN_SA_KEY_BASE64, GOOGLE_ADMIN_SA_KEY hoặc GOOGLE_ADMIN_SA_KEY_FILE.",
    );
  }

  let parsed: Partial<ServiceAccountKey>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AdminConfigError("Service Account key không phải JSON hợp lệ.");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new AdminConfigError("Service Account key thiếu client_email hoặc private_key.");
  }
  // Hỗ trợ trường hợp private_key bị escape \n khi dán vào biến môi trường.
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
    source,
  };
}

export function getWorkspaceDomain(): string {
  const domain = process.env.GOOGLE_WORKSPACE_DOMAIN?.trim();
  if (!domain) {
    throw new AdminConfigError("Chưa đặt GOOGLE_WORKSPACE_DOMAIN trong .env.local.");
  }
  return domain;
}

/**
 * Email các nhóm "học thử" mà cộng tác viên (CTV) được phép thao tác.
 * Khai báo qua CTV_TRIAL_GROUP_EMAILS. Nếu chưa cấu hình, CTV bị chặn hết (fail closed).
 */
function envEmailList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(/[,\n]/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function getCtvTrialGroupKeys(): string[] {
  return Array.from(
    new Set([
      ...envEmailList("CTV_TRIAL_GROUP_EMAILS"),
      ...envEmailList("CTV_TRIAL_GROUP_EMAIL"),
    ]),
  );
}

export function getCtvTrialGroupKey(): string | null {
  return getCtvTrialGroupKeys()[0] ?? null;
}

/** So khớp groupKey (email nhóm) với nhóm học thử, không phân biệt hoa/thường/khoảng trắng. */
export function isCtvTrialGroup(groupKey: string): boolean {
  const normalized = groupKey.trim().toLowerCase();
  return getCtvTrialGroupKeys().includes(normalized);
}

export function getAdminRuntimeConfig() {
  const domain = getWorkspaceDomain();
  const impersonateEmail = process.env.GOOGLE_ADMIN_IMPERSONATE_EMAIL?.trim();
  if (!impersonateEmail) {
    throw new AdminConfigError(
      "Chưa đặt GOOGLE_ADMIN_IMPERSONATE_EMAIL (email super-admin) trong .env.local.",
    );
  }
  const key = loadServiceAccountKey();

  return {
    domain,
    impersonateEmail,
    serviceAccountEmail: key.client_email,
    credentialSource: key.source,
  };
}

let cachedClient: admin_directory_v1.Admin | null = null;

/**
 * Trả về Directory API client đã xác thực bằng Service Account
 * và impersonate super-admin. Ném AdminConfigError nếu thiếu cấu hình.
 */
export function getDirectory(): admin_directory_v1.Admin {
  if (cachedClient) return cachedClient;

  const config = getAdminRuntimeConfig();
  const key = loadServiceAccountKey();
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: SCOPES,
    subject: config.impersonateEmail, // domain-wide delegation: đóng vai super-admin
  });

  cachedClient = google.admin({ version: "directory_v1", auth });
  return cachedClient;
}

/** Lấy thông tin một nhóm theo groupKey (email hoặc id). Dùng để CTV chỉ thấy nhóm học thử. */
export async function getGroupByKey(groupKey: string) {
  const directory = getDirectory();
  const res = await directory.groups.get({ groupKey });
  const g = res.data;
  return {
    id: g.id ?? "",
    email: g.email ?? "",
    name: g.name ?? g.email ?? "",
    description: g.description ?? "",
    directMembersCount: Number(g.directMembersCount ?? 0),
    isTrial: isCtvTrialGroup(g.email ?? groupKey),
  };
}

/** True nếu email là thành viên (trực tiếp/gián tiếp) của nhóm groupKey. */
export async function userIsGroupMember(email: string, groupKey: string): Promise<boolean> {
  const directory = getDirectory();
  try {
    const res = await directory.members.hasMember({ groupKey, memberKey: email });
    return Boolean(res.data.isMember);
  } catch (error) {
    // hasMember trả 404 khi user không thuộc nhóm hoặc không tồn tại → coi như không phải thành viên.
    const code = (error as { code?: number }).code;
    if (code === 404) return false;
    throw error;
  }
}

type DirectoryGroupRole = "OWNER" | "MANAGER" | "MEMBER";

function getApiStatusCode(error: unknown): number | undefined {
  const err = error as { code?: number; status?: number };
  return err.code ?? err.status;
}

function getGoogleApiMessage(error: unknown): string {
  const err = error as { response?: { data?: unknown }; errors?: unknown[] };
  return (
    getErrorMessage(err.response?.data, "") ||
    err.errors?.map((item) => getErrorMessage(item, "")).find(Boolean) ||
    getErrorMessage(error, "")
  );
}

function isGoogleResourceNotFound(error: unknown, resourceKey: string): boolean {
  if (getApiStatusCode(error) !== 404) return false;
  const message = getGoogleApiMessage(error).toLowerCase();
  return message.includes("resource not found") && message.includes(resourceKey.toLowerCase());
}

async function getExistingGroupMember(
  directory: admin_directory_v1.Admin,
  groupKey: string,
  memberEmail: string,
): Promise<admin_directory_v1.Schema$Member | null> {
  try {
    const res = await directory.members.get({ groupKey, memberKey: memberEmail });
    return res.data;
  } catch {
    let pageToken: string | undefined;
    do {
      const res = await directory.members.list({ groupKey, maxResults: 200, pageToken });
      const member = (res.data.members ?? []).find(
        (item) => item.email?.trim().toLowerCase() === memberEmail,
      );
      if (member) return member;
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return null;
  }
}

export async function ensureGroupMember(
  directory: admin_directory_v1.Admin,
  groupKey: string,
  email: string,
  role: DirectoryGroupRole = "MEMBER",
): Promise<admin_directory_v1.Schema$Member> {
  const memberEmail = email.trim().toLowerCase();
  try {
    const res = await directory.members.insert({
      groupKey,
      requestBody: { email: memberEmail, role },
    });
    return res.data;
  } catch (error) {
    if (isGoogleResourceNotFound(error, memberEmail)) {
      throw new AdminUserError(
        `Không thêm được ${memberEmail}: Google không tìm thấy tài khoản hoặc Google Group này. Hãy kiểm tra lại email và chắc chắn tài khoản/group đã tồn tại trước khi thêm.`,
      );
    }

    if (getApiStatusCode(error) !== 409) throw error;
    const existingMember = await getExistingGroupMember(directory, groupKey, memberEmail);
    return existingMember ?? { email: memberEmail, role, type: "USER" };
  }
}

export async function ensureSheetHocDthtMember(
  directory: admin_directory_v1.Admin,
  email: string,
  sourceGroupKey?: string,
): Promise<admin_directory_v1.Schema$Member | null> {
  if (sourceGroupKey?.trim().toLowerCase() === SHEET_HOC_DTHT_GROUP_EMAIL) {
    return null;
  }
  return ensureGroupMember(directory, SHEET_HOC_DTHT_GROUP_EMAIL, email, "MEMBER");
}

/** Chuẩn hóa lỗi từ googleapis thành { status, message } để trả về client. */
export function describeApiError(error: unknown): { status: number; message: string } {
  if (error instanceof AdminUserError) {
    return { status: error.status, message: error.message };
  }
  if (error instanceof AdminConfigError) {
    return { status: 503, message: error.message };
  }
  const err = error as { code?: number; errors?: unknown[] };
  const status = typeof err.code === "number" ? err.code : 500;
  const message =
    err.errors?.map((item) => getErrorMessage(item, "")).find(Boolean) ||
    getErrorMessage(error, "Lỗi không xác định khi gọi Admin SDK.");
  return { status, message };
}
