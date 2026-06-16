#!/usr/bin/env node

// Tạo một Google Group đích rồi gộp TẤT CẢ học viên hiện có (live membership của
// mọi group trong domain) làm MEMBER của group đó.
//
// Nguồn học viên = members.list của từng group qua Directory API (có phân trang),
// chỉ lấy member type USER, gộp trùng (dedupe theo email).
// Idempotent: group đã tồn tại thì dùng lại; member đã có (409) thì bỏ qua.
//
// Dùng:
//   node scripts/add-all-students-to-group.mjs --group-email bonus-combo-2k9@dautruonghoctap.io.vn --group-name "BONUS COMBO HS12 2027 2K9"
//   node scripts/add-all-students-to-group.mjs ... --dry-run

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { google } from "googleapis";

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
      () => directory.groups.list({ domain, maxResults: 200, pageToken }),
      "groups.list",
    );
    for (const g of res.data.groups || []) {
      if (g.email) emails.push(g.email.toLowerCase());
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return emails;
}

async function listGroupMemberEmails(directory, groupEmail) {
  const emails = [];
  let pageToken;
  do {
    const res = await withRetry(
      () => directory.members.list({ groupKey: groupEmail, maxResults: 200, pageToken }),
      `members.list ${groupEmail}`,
    );
    for (const m of res.data.members || []) {
      if (m.type === "USER" && m.email) emails.push(m.email.toLowerCase());
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return emails;
}

async function ensureGroup(directory, { groupEmail, groupName, description, dryRun }) {
  try {
    await withRetry(() => directory.groups.get({ groupKey: groupEmail }), `groups.get ${groupEmail}`);
    return "exists";
  } catch (error) {
    if (error?.code !== 404) throw error;
  }
  if (dryRun) return "would-create";
  await withRetry(
    () =>
      directory.groups.insert({
        requestBody: { email: groupEmail, name: groupName, description },
      }),
    `groups.insert ${groupEmail}`,
  );
  return "created";
}

async function ensureMember(directory, groupEmail, memberEmail, dryRun) {
  if (dryRun) return "would-add";
  try {
    await withRetry(
      () =>
        directory.members.insert({
          groupKey: groupEmail,
          requestBody: { email: memberEmail, role: "MEMBER" },
        }),
      `members.insert ${memberEmail} -> ${groupEmail}`,
    );
    return "added";
  } catch (error) {
    if (error?.code === 409) return "already-member";
    throw error;
  }
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const { values } = parseArgs({
    options: {
      "group-email": { type: "string" },
      "group-name": { type: "string" },
      description: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  const domain = requiredEnv("GOOGLE_WORKSPACE_DOMAIN");
  const impersonateEmail = requiredEnv("GOOGLE_ADMIN_IMPERSONATE_EMAIL");

  const groupEmail = values["group-email"]?.trim().toLowerCase();
  if (!groupEmail) throw new Error("Thiếu --group-email.");
  if (!groupEmail.endsWith(`@${domain}`)) {
    throw new Error(`Group email phải thuộc domain ${domain}: ${groupEmail}`);
  }
  const groupName = values["group-name"]?.trim() || groupEmail.split("@")[0];
  const description = values.description?.trim() || "";
  const dryRun = Boolean(values["dry-run"]);

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
  console.log(`Group đích   : ${groupEmail} ("${groupName}")`);
  if (dryRun) console.log("Mode        : dry-run, không ghi dữ liệu.\n");

  // 1) Gộp toàn bộ học viên hiện có từ mọi group.
  const allGroups = await listAllGroups(directory, domain);
  console.log(`\nTìm thấy ${allGroups.length} group. Đang gộp member...`);
  const students = new Set();
  for (const g of allGroups) {
    const emails = await listGroupMemberEmails(directory, g);
    for (const e of emails) students.add(e);
  }
  // Không tự thêm chính group đích vào danh sách (nếu nó đã tồn tại từ trước).
  students.delete(groupEmail);
  const studentList = [...students].sort();
  console.log(`→ ${studentList.length} học viên duy nhất.\n`);

  // 2) Tạo group đích.
  const groupState = await ensureGroup(directory, { groupEmail, groupName, description, dryRun });
  console.log(`Group: ${groupState}\n`);

  // 3) Thêm tất cả học viên làm MEMBER.
  const counts = { added: 0, "already-member": 0, "would-add": 0 };
  for (const email of studentList) {
    const state = await ensureMember(directory, groupEmail, email, dryRun);
    counts[state] = (counts[state] || 0) + 1;
    console.log(`  ${state.padEnd(15)} ${email}`);
  }

  console.log("\n=== Tổng kết ===");
  console.log(`Học viên xử lý : ${studentList.length}`);
  for (const [k, v] of Object.entries(counts)) if (v) console.log(`  ${k}: ${v}`);
}

main().catch((error) => {
  console.error(describeApiError(error));
  process.exit(1);
});
