#!/usr/bin/env node

// Kiểm tra (đọc) thiết lập hiển thị của tất cả group domain — KHÔNG ghi.
// In ra các trường quyết định việc thành viên NGOÀI domain có thấy/ xem được group.
//
// Dùng: node scripts/inspect-group-settings.mjs
//       node scripts/inspect-group-settings.mjs --limit 5

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/apps.groups.settings",
];

const FIELDS = [
  "whoCanViewGroup",
  "whoCanViewMembership",
  "whoCanDiscoverGroup",
  "showInGroupDirectory",
  "allowExternalMembers",
  "whoCanJoin",
];

function loadEnvFile(fileName) {
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

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Thiếu biến môi trường ${name}.`);
  return value;
}

function loadServiceAccountKey() {
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

function describeApiError(error) {
  const message = error?.errors?.[0]?.message || error?.message || String(error);
  const code = error?.code ? `HTTP ${error.code}: ` : "";
  return `${code}${message}`;
}

async function listAllGroups(directory, domain) {
  const emails = [];
  let pageToken;
  do {
    const res = await directory.groups.list({ domain, maxResults: 200, pageToken });
    for (const g of res.data.groups || []) if (g.email) emails.push(g.email.toLowerCase());
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return emails;
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const { values } = parseArgs({ options: { limit: { type: "string" } } });
  const limit = values.limit ? Number(values.limit) : Infinity;

  const domain = requiredEnv("GOOGLE_WORKSPACE_DOMAIN");
  const impersonateEmail = requiredEnv("GOOGLE_ADMIN_IMPERSONATE_EMAIL");
  const key = loadServiceAccountKey();
  const auth = new google.auth.JWT({
    email: key.clientEmail,
    key: key.privateKey,
    scopes: SCOPES,
    subject: impersonateEmail,
  });
  const directory = google.admin({ version: "directory_v1", auth });
  const settings = google.groupssettings({ version: "v1", auth });

  const groupEmails = await listAllGroups(directory, domain);
  console.log(`Tìm thấy ${groupEmails.length} group. Đọc thiết lập ${Math.min(limit, groupEmails.length)} group:\n`);

  const tally = {};
  let idx = 0;
  for (const groupEmail of groupEmails) {
    if (idx >= limit) break;
    idx++;
    try {
      const res = await settings.groups.get({ groupUniqueId: groupEmail });
      const d = res.data;
      const parts = FIELDS.map((f) => `${f}=${d[f]}`);
      console.log(`[${idx}] ${groupEmail}\n      ${parts.join("\n      ")}`);
      for (const f of FIELDS) {
        const k = `${f}=${d[f]}`;
        tally[k] = (tally[k] || 0) + 1;
      }
    } catch (error) {
      console.log(`[${idx}] ${groupEmail}  LỖI ${describeApiError(error)}`);
    }
  }

  console.log("\n========== THỐNG KÊ GIÁ TRỊ ==========");
  for (const k of Object.keys(tally).sort()) console.log(`  ${k}  ×${tally[k]}`);
}

main().catch((error) => {
  console.error(describeApiError(error));
  process.exit(1);
});
