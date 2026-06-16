#!/usr/bin/env node

// Bật hiển thị/khám phá cho TOÀN BỘ group domain để thành viên (kể cả ngoài domain)
// tìm thấy group trong directory + ô search "All groups" trên groups.google.com.
// Patch qua Groups Settings API (cần scope apps.groups.settings, đã được DWD cấp).
//
// Đặt:
//   showInGroupDirectory   = true
//   whoCanDiscoverGroup    = ANYONE_CAN_DISCOVER
//   whoCanViewGroup        = ALL_MEMBERS_CAN_VIEW   (giữ owner ngoài domain xem được)
//   whoCanViewMembership   = ALL_MEMBERS_CAN_VIEW
//   allowExternalMembers   = true
//
// Dùng: node scripts/set-group-visibility.mjs
//       node scripts/set-group-visibility.mjs --dry-run

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { google } from "googleapis";

const DESIRED = {
  showInGroupDirectory: "true",
  whoCanDiscoverGroup: "ANYONE_CAN_DISCOVER",
  whoCanViewGroup: "ALL_MEMBERS_CAN_VIEW",
  whoCanViewMembership: "ALL_MEMBERS_CAN_VIEW",
  allowExternalMembers: "true",
};

const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/apps.groups.settings",
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

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn, label) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const code = error?.code;
      if ((code === 403 || code === 429 || code >= 500) && attempt < 5) {
        const wait = 1000 * attempt;
        console.log(`   ↻ retry ${label} sau ${wait}ms (${describeApiError(error)})`);
        await sleep(wait);
        continue;
      }
      throw error;
    }
  }
}

async function listAllGroups(directory, domain) {
  const emails = [];
  let pageToken;
  do {
    const res = await withRetry(
      () => directory.groups.list({ domain, maxResults: 200, pageToken }),
      "groups.list",
    );
    for (const g of res.data.groups || []) if (g.email) emails.push(g.email.toLowerCase());
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return emails;
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
  const dryRun = Boolean(values["dry-run"]);

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

  console.log(`Domain      : ${domain}`);
  console.log(`Mục tiêu    : ${JSON.stringify(DESIRED)}`);
  console.log(dryRun ? "Mode        : DRY-RUN\n" : "Mode        : LIVE\n");

  const groupEmails = await listAllGroups(directory, domain);
  console.log(`Tìm thấy ${groupEmails.length} group.\n`);

  const summary = { patched: 0, alreadyOk: 0, errors: [] };

  let idx = 0;
  for (const groupEmail of groupEmails) {
    idx++;
    try {
      const cur = await withRetry(
        () => settings.groups.get({ groupUniqueId: groupEmail, alt: "json" }),
        `get ${groupEmail}`,
      );
      const d = cur.data || {};
      const diff = {};
      for (const [k, v] of Object.entries(DESIRED)) {
        if (String(d[k]) !== String(v)) diff[k] = v;
      }
      if (Object.keys(diff).length === 0) {
        summary.alreadyOk++;
        console.log(`[${idx}/${groupEmails.length}] ${groupEmail}: đã đúng`);
        continue;
      }
      if (dryRun) {
        console.log(`[${idx}/${groupEmails.length}] ${groupEmail}: would-set ${JSON.stringify(diff)}`);
        summary.patched++;
        continue;
      }
      await withRetry(
        () => settings.groups.patch({ groupUniqueId: groupEmail, alt: "json", requestBody: diff }),
        `patch ${groupEmail}`,
      );
      summary.patched++;
      console.log(`[${idx}/${groupEmails.length}] ${groupEmail}: set ${JSON.stringify(diff)}`);
    } catch (error) {
      const msg = describeApiError(error);
      summary.errors.push(`${groupEmail}: ${msg}`);
      console.log(`[${idx}/${groupEmails.length}] ${groupEmail}: LỖI ${msg}`);
    }
  }

  console.log("\n========== TỔNG KẾT ==========");
  console.log(`Đã chỉnh    : ${summary.patched}`);
  console.log(`Đã đúng sẵn : ${summary.alreadyOk}`);
  console.log(`Lỗi         : ${summary.errors.length}`);
  for (const e of summary.errors) console.log(" * " + e);
}

main().catch((error) => {
  console.error(describeApiError(error));
  process.exit(1);
});
