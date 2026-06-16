#!/usr/bin/env node

// Tạo hàng loạt Google Group trong Workspace domain rồi thêm thành viên.
// Đọc file TSV: mỗi dòng = "<group-localpart-hoặc-email>\t<member-email>".
// Group ghi dưới dạng local-part (vd 2k9-toan-ful) sẽ được nối @<domain>.
// Idempotent: group đã tồn tại thì bỏ qua tạo; thành viên trùng (409) coi như đã có.

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

function parseTsv(filePath, domain) {
  const raw = readFileSync(filePath, "utf8");
  const groups = new Map(); // groupEmail -> Set(memberEmail)
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\t+/);
    if (parts.length < 2) continue;
    let group = parts[0].trim().toLowerCase();
    const member = parts[1].trim().toLowerCase();
    if (!group || !member) continue;
    // Nếu ghi dưới dạng email khác domain (vd @googlegroups.com) thì lấy local-part.
    if (group.includes("@")) group = group.split("@")[0];
    const groupEmail = `${group}@${domain}`;
    if (!groups.has(groupEmail)) groups.set(groupEmail, new Set());
    groups.get(groupEmail).add(member);
  }
  return groups;
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
      // 403 rate / 429 / 5xx -> backoff & retry
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

async function ensureGroup(directory, groupEmail, dryRun) {
  try {
    await directory.groups.get({ groupKey: groupEmail });
    return "exists";
  } catch (error) {
    if (error?.code !== 404) throw error;
  }
  if (dryRun) return "would-create";
  await withRetry(
    () =>
      directory.groups.insert({
        requestBody: { email: groupEmail, name: groupEmail.split("@")[0] },
      }),
    `insert group ${groupEmail}`,
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
      `add ${memberEmail} -> ${groupEmail}`,
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
      file: { type: "string", default: "scripts/groups-members.tsv" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const dryRun = Boolean(values["dry-run"]);
  const dataFile = resolve(process.cwd(), values.file);

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

  const groups = parseTsv(dataFile, domain);

  console.log(`Domain      : ${domain}`);
  console.log(`Impersonate : ${impersonateEmail}`);
  console.log(`Data file   : ${dataFile}`);
  console.log(`Số group    : ${groups.size}`);
  console.log(dryRun ? "Mode        : DRY-RUN (không gọi API ghi)\n" : "Mode        : LIVE\n");

  const summary = {
    groupsCreated: 0,
    groupsExisted: 0,
    membersAdded: 0,
    membersExisting: 0,
    errors: [],
  };

  let idx = 0;
  for (const [groupEmail, members] of groups) {
    idx++;
    process.stdout.write(`[${idx}/${groups.size}] ${groupEmail} (${members.size} tv) ... `);
    let gState;
    try {
      gState = await ensureGroup(directory, groupEmail, dryRun);
    } catch (error) {
      const msg = describeApiError(error);
      console.log(`LỖI tạo group: ${msg}`);
      summary.errors.push(`group ${groupEmail}: ${msg}`);
      continue;
    }
    if (gState === "created" || gState === "would-create") summary.groupsCreated++;
    else summary.groupsExisted++;
    console.log(gState);

    // Group mới cần ít giây để propagate trước khi thêm member.
    if (gState === "created") await sleep(1500);

    for (const member of members) {
      try {
        const mState = await ensureMember(directory, groupEmail, member, dryRun);
        if (mState === "added" || mState === "would-add") summary.membersAdded++;
        else summary.membersExisting++;
        console.log(`     - ${member}: ${mState}`);
      } catch (error) {
        const msg = describeApiError(error);
        console.log(`     - ${member}: LỖI ${msg}`);
        summary.errors.push(`member ${member} -> ${groupEmail}: ${msg}`);
      }
    }
  }

  console.log("\n========== TỔNG KẾT ==========");
  console.log(`Group tạo mới   : ${summary.groupsCreated}`);
  console.log(`Group đã có     : ${summary.groupsExisted}`);
  console.log(`Thành viên thêm : ${summary.membersAdded}`);
  console.log(`Thành viên đã có: ${summary.membersExisting}`);
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
