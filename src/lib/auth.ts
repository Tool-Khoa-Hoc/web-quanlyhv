import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { google } from "googleapis";

import { AdminConfigError, getWorkspaceDomain } from "./google-admin";

// ===== Cấu hình OAuth + Session cho đăng nhập cộng tác viên =====

export const SESSION_COOKIE = "dth_session";
export const OAUTH_STATE_COOKIE = "dth_oauth_state";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 giờ

export type AppRole = "admin" | "ctv";

export interface AppSession {
  email: string;
  name: string;
  role: AppRole;
  /** epoch seconds */
  exp: number;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  adminEmails: string[];
  domain: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AdminConfigError(`Chưa đặt ${name} trong .env.local (cần cho đăng nhập Google).`);
  }
  return value;
}

export function getOAuthConfig(): OAuthConfig {
  const domain = getWorkspaceDomain();
  const impersonate = process.env.GOOGLE_ADMIN_IMPERSONATE_EMAIL?.trim().toLowerCase();
  const extraAdmins = (process.env.APP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const adminEmails = Array.from(new Set([impersonate, ...extraAdmins].filter(Boolean) as string[]));

  return {
    clientId: requiredEnv("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: requiredEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    sessionSecret: requiredEnv("APP_SESSION_SECRET"),
    adminEmails,
    domain,
  };
}

/** Giá trị mẫu trong .env.local.example — coi như chưa cấu hình. */
function isRealValue(value: string | undefined): boolean {
  const v = value?.trim();
  if (!v) return false;
  if (v.startsWith("PASTE_") || v.startsWith("xxxxxxxx")) return false;
  if (v.includes("thay-bang") || v.includes("thay-bang-chuoi")) return false;
  return true;
}

export function isOAuthConfigured(): boolean {
  return Boolean(
    isRealValue(process.env.GOOGLE_OAUTH_CLIENT_ID) &&
      isRealValue(process.env.GOOGLE_OAUTH_CLIENT_SECRET) &&
      isRealValue(process.env.APP_SESSION_SECRET) &&
      process.env.GOOGLE_WORKSPACE_DOMAIN?.trim(),
  );
}

export function roleForEmail(email: string, config: OAuthConfig): AppRole {
  return config.adminEmails.includes(email.toLowerCase()) ? "admin" : "ctv";
}

/** Tạo OAuth2 client với redirect URI suy ra từ origin của request. */
export function createOAuthClient(origin: string) {
  const config = getOAuthConfig();
  return new google.auth.OAuth2({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: `${origin}/api/auth/callback`,
  });
}

// ===== Session token: payload base64url + chữ ký HMAC-SHA256 =====

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sign(body: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(body).digest());
}

export function signSession(
  data: Omit<AppSession, "exp">,
  secret: string,
): { token: string; maxAge: number } {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload: AppSession = { ...data, exp };
  const body = base64url(JSON.stringify(payload));
  const token = `${body}.${sign(body, secret)}`;
  return { token, maxAge: SESSION_TTL_SECONDS };
}

export function verifySessionToken(token: string, secret: string): AppSession | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body, secret);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const json = Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(json) as AppSession;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (!payload.email || (payload.role !== "admin" && payload.role !== "ctv")) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/** Đọc + xác thực session từ cookie. Trả null nếu chưa đăng nhập / hết hạn / cấu hình thiếu. */
export async function getSession(): Promise<AppSession | null> {
  if (!isOAuthConfigured()) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return verifySessionToken(token, getOAuthConfig().sessionSecret);
  } catch {
    return null;
  }
}

export function newStateToken(): string {
  return randomBytes(16).toString("hex");
}
