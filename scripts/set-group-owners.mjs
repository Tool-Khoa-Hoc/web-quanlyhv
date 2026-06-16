#!/usr/bin/env node

// Đặt một số email làm OWNER của TOÀN BỘ group trong Workspace domain.
// Lấy danh sách group qua Directory API groups.list (có phân trang).
// Idempotent: chưa có thì thêm với role OWNER; đã là member thì nâng role lên OWNER;
// đã là OWNER thì bỏ qua.
//
// Dùng: node scripts/set-group-owners.mjs            (live)
//       node scripts/set-group-owners.mjs --dry-run

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { google } from "googleapis";

// Hai email cần đặt làm OWNER của mọi group.
const OWNER_EMAILS = [
  "klinh18183176@gmail.com",
  "tamatm6713@gmail.com",
  "dthtadmin@dautruonghoctap.io.vn",
];

const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/admin.directory.group.member",
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
      () =>
        directory.groups.list({
          domain,
          maxResults: 200,
          pageToken,
        }),
      "groups.list",
    );
    for (const g of res.data.groups || []) {
      if (g.email) emails.push(g.email.toLowerCase());
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return emails;
}

// Đảm bảo memberEmail là OWNER của groupEmail. Trả về trạng thái.
async function ensureOwner(directory, groupEmail, memberEmail, dryRun) {
  if (dryRun) return "would-set-owner";
  try {
    await withRetry(
      () =>
        directory.members.insert({
          groupKey: groupEmail,
          requestBody: { email: memberEmail, role: "OWNER" },
        }),
      `insert owner ${memberEmail} -> ${groupEmail}`,
    );
    return "added-owner";
  } catch (error) {
    if (error?.code !== 409) throw error;
  }
  // Đã là member: kiểm tra role, nâng lên OWNER nếu cần.
  const current = await withRetry(
    () => directory.members.get({ groupKey: groupEmail, memberKey: memberEmail }),
    `get member ${memberEmail} @ ${groupEmail}`,
  );
  if ((current.data.role || "").toUpperCase() === "OWNER") return "already-owner";
  await withRetry(
    () =>
      directory.members.update({
        groupKey: groupEmail,
        memberKey: memberEmail,
        requestBody: { email: memberEmail, role: "OWNER" },
      }),
    `update role ${memberEmail} -> OWNER @ ${groupEmail}`,
  );
  return "promoted-owner";
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const { values } = parseArgs({
    options: { "dry-run": { type: "boolean", default: false } },
  });
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

  console.log(`Domain      : ${domain}`);
  console.log(`Impersonate : ${impersonateEmail}`);
  console.log(`Owner emails: ${OWNER_EMAILS.join(", ")}`);
  console.log(dryRun ? "Mode        : DRY-RUN (không gọi API ghi)\n" : "Mode        : LIVE\n");

  const groupEmails = await listAllGroups(directory, domain);
  console.log(`Tìm thấy ${groupEmails.length} group trong domain.\n`);

  const summary = { added: 0, promoted: 0, already: 0, errors: [] };

  let idx = 0;
  for (const groupEmail of groupEmails) {
    idx++;
    console.log(`[${idx}/${groupEmails.length}] ${groupEmail}`);
    for (const owner of OWNER_EMAILS) {
      try {
        const state = await ensureOwner(directory, groupEmail, owner, dryRun);
        if (state === "added-owner" || state === "would-set-owner") summary.added++;
        else if (state === "promoted-owner") summary.promoted++;
        else summary.already++;
        console.log(`     - ${owner}: ${state}`);
      } catch (error) {
        const msg = describeApiError(error);
        console.log(`     - ${owner}: LỖI ${msg}`);
        summary.errors.push(`${owner} -> ${groupEmail}: ${msg}`);
      }
    }
  }

  console.log("\n========== TỔNG KẾT ==========");
  console.log(`Số group        : ${groupEmails.length}`);
  console.log(`Thêm OWNER mới  : ${summary.added}`);
  console.log(`Nâng lên OWNER  : ${summary.promoted}`);
  console.log(`Đã là OWNER     : ${summary.already}`);
  console.log(`Lỗi             : ${summary.errors.length}`);
  if (summary.errors.length) {
    console.log("\n--- Chi tiết lỗi ---");
    for (const e of summary.errors) console.log(" * " + e);
  }
}

main().catch((error) => {
  console.error(describeApiError(error));
  process.exit(1);
});
