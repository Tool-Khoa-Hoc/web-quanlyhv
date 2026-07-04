// Helper dùng chung cho các script vận hành trong scripts/.
// Gom phần boilerplate bị lặp ở nhiều script: nạp .env, đọc Service Account key,
// tạo Directory API client (impersonate super-admin), mô tả lỗi, retry có backoff.
//
// Cách dùng trong một script mới:
//   import { loadEnv, getDirectory, describeApiError, withRetry } from "./_shared.mjs";
//   loadEnv();
//   const directory = getDirectory();

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { google } from "googleapis";

export const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/admin.directory.group.member",
];

/** Nạp biến môi trường từ một file dạng KEY=VALUE (bỏ qua nếu không tồn tại). */
export function loadEnvFile(fileName) {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (!key || process.env[key]) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/** Nạp lần lượt .env.local rồi .env (biến đã set trước được giữ nguyên). */
export function loadEnv() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");
}

export function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Thiếu biến môi trường ${name}.`);
  return value;
}

export function loadServiceAccountKey() {
  const inline = process.env.GOOGLE_ADMIN_SA_KEY?.trim();
  const base64 = process.env.GOOGLE_ADMIN_SA_KEY_BASE64?.trim();
  const filePath = process.env.GOOGLE_ADMIN_SA_KEY_FILE?.trim();
  let raw;
  if (inline) raw = inline;
  else if (base64) raw = Buffer.from(base64, "base64").toString("utf8");
  else if (filePath) raw = readFileSync(filePath, "utf8");
  else throw new Error("Thiếu Service Account key (GOOGLE_ADMIN_SA_KEY_FILE/_BASE64/_KEY).");
  const key = JSON.parse(raw);
  if (!key.client_email || !key.private_key) {
    throw new Error("Service Account key thiếu client_email hoặc private_key.");
  }
  return { clientEmail: key.client_email, privateKey: key.private_key.replace(/\\n/g, "\n") };
}

/**
 * Tạo Directory API client đã xác thực bằng Service Account + impersonate super-admin.
 * @param {string[]} scopes - scope OAuth (mặc định: quản lý group + member).
 */
export function getDirectory(scopes = SCOPES) {
  const { clientEmail, privateKey } = loadServiceAccountKey();
  const impersonateEmail = requiredEnv("GOOGLE_ADMIN_IMPERSONATE_EMAIL");
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes,
    subject: impersonateEmail,
  });
  return google.admin({ version: "directory_v1", auth });
}

export function describeApiError(error) {
  const message = error?.errors?.[0]?.message || error?.message || String(error);
  const code = error?.code ? `HTTP ${error.code}: ` : "";
  return `${code}${message}`;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Gọi fn() với backoff khi gặp 403 rate / 429 / 5xx. Tối đa `maxAttempts` lần. */
export async function withRetry(fn, label, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const code = error?.code;
      if ((code === 403 || code === 429 || code >= 500) && attempt < maxAttempts) {
        const wait = 1000 * attempt;
        console.log(`   ↻ retry ${label} sau ${wait}ms (${describeApiError(error)})`);
        await sleep(wait);
        continue;
      }
      throw error;
    }
  }
}
