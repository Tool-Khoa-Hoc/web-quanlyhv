import "server-only";

import { readFileSync } from "node:fs";
import { google, type admin_directory_v1 } from "googleapis";
import type { ApiAdminCredentialSource } from "./admin-types";

// Scopes tối thiểu để đọc nhóm + thêm/xóa/sửa thành viên.
const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/admin.directory.group.member",
];

export class AdminConfigError extends Error {}

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
 * Email nhóm "học thử" — nhóm DUY NHẤT mà cộng tác viên (CTV) được phép thao tác.
 * Khai báo qua CTV_TRIAL_GROUP_EMAIL. Trả null nếu chưa cấu hình (khi đó CTV bị chặn hết — fail closed).
 */
export function getCtvTrialGroupKey(): string | null {
  const v = process.env.CTV_TRIAL_GROUP_EMAIL?.trim().toLowerCase();
  return v ? v : null;
}

/** So khớp groupKey (email nhóm) với nhóm học thử, không phân biệt hoa/thường/khoảng trắng. */
export function isCtvTrialGroup(groupKey: string): boolean {
  const trial = getCtvTrialGroupKey();
  return Boolean(trial && groupKey.trim().toLowerCase() === trial);
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

/**
 * Liệt kê các nhóm mà một user (email) là thành viên trong domain.
 * Dùng cho cộng tác viên: chỉ thấy nhóm họ được cấp quyền (được thêm vào nhóm).
 */
export async function listGroupsForUser(email: string) {
  const directory = getDirectory();
  const groups: Array<{
    id: string;
    email: string;
    name: string;
    description: string;
    directMembersCount: number;
  }> = [];
  let pageToken: string | undefined;
  do {
    const res = await directory.groups.list({
      userKey: email,
      maxResults: 200,
      pageToken,
    });
    for (const g of res.data.groups ?? []) {
      groups.push({
        id: g.id ?? "",
        email: g.email ?? "",
        name: g.name ?? g.email ?? "",
        description: g.description ?? "",
        directMembersCount: Number(g.directMembersCount ?? 0),
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return groups;
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

export function isConfigured(): boolean {
  return Boolean(
    (process.env.GOOGLE_ADMIN_SA_KEY?.trim() ||
      process.env.GOOGLE_ADMIN_SA_KEY_BASE64?.trim() ||
      process.env.GOOGLE_ADMIN_SA_KEY_FILE?.trim()) &&
      process.env.GOOGLE_ADMIN_IMPERSONATE_EMAIL?.trim() &&
      process.env.GOOGLE_WORKSPACE_DOMAIN?.trim(),
  );
}

/** Chuẩn hóa lỗi từ googleapis thành { status, message } để trả về client. */
export function describeApiError(error: unknown): { status: number; message: string } {
  if (error instanceof AdminConfigError) {
    return { status: 503, message: error.message };
  }
  const err = error as { code?: number; errors?: Array<{ message?: string }>; message?: string };
  const status = typeof err.code === "number" ? err.code : 500;
  const message =
    err.errors?.[0]?.message || err.message || "Lỗi không xác định khi gọi Admin SDK.";
  return { status, message };
}
