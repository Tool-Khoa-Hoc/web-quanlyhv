#!/usr/bin/env node

// Tạo một Google Group rồi add danh sách member cụ thể (truyền qua --members).
// Idempotent: group đã tồn tại thì dùng lại; member đã có (409) thì bỏ qua.
//
// Dùng:
//   node scripts/create-group-add-members.mjs \
//     --group-email up-khoa-hoc@dautruonghoctap.io.vn \
//     --group-name "úp khóa học" \
//     --members "a@gmail.com,b@gmail.com"
//   thêm --dry-run để chỉ in, không ghi.

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
  let filePath = process.env.GOOGLE_ADMIN_SA_KEY_FILE?.trim();
  let raw;
  if (inline) raw = inline;
  else if (base64) raw = Buffer.from(base64, "base64").toString("utf8");
  else if (filePath) {
    if (!existsSync(filePath)) {
      const fallback = resolve(process.cwd(), "secrets/service-account.json");
      if (existsSync(fallback)) filePath = fallback;
    }
    raw = readFileSync(filePath, "utf8");
  } else throw new Error("Thiếu Service Account key (GOOGLE_ADMIN_SA_KEY_FILE/_BASE64/_KEY).");
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

async function ensureGroup(directory, { groupEmail, groupName, description, dryRun }) {
  try {
    await withRetry(() => directory.groups.get({ groupKey: groupEmail }), `groups.get ${groupEmail}`);
    return "exists";
  } catch (error) {
    if (error?.code !== 404) throw error;
  }
  if (dryRun) return "would-create";
  await withRetry(
    () => directory.groups.insert({ requestBody: { email: groupEmail, name: groupName, description } }),
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
      members: { type: "string" },
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

  const members = [
    ...new Set(
      (values.members || "")
        .split(/[,\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (!members.length) throw new Error("Thiếu --members (danh sách email, ngăn cách bằng dấu phẩy).");

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
  console.log(`Group đích  : ${groupEmail} ("${groupName}")`);
  console.log(`Số member   : ${members.length}`);
  console.log(dryRun ? "Mode        : DRY-RUN (không ghi)\n" : "Mode        : LIVE\n");

  const groupState = await ensureGroup(directory, { groupEmail, groupName, description, dryRun });
  console.log(`Group: ${groupState}\n`);
  if (groupState === "created") await sleep(1500); // chờ group propagate

  const counts = {};
  for (const email of members) {
    let state;
    try {
      state = await ensureMember(directory, groupEmail, email, dryRun);
    } catch (error) {
      state = "ERROR";
      console.log(`  ${"ERROR".padEnd(15)} ${email} — ${describeApiError(error)}`);
    }
    counts[state] = (counts[state] || 0) + 1;
    if (state !== "ERROR") console.log(`  ${state.padEnd(15)} ${email}`);
  }

  console.log("\n=== Tổng kết ===");
  console.log(`Member xử lý : ${members.length}`);
  for (const [k, v] of Object.entries(counts)) if (v) console.log(`  ${k}: ${v}`);
}

main().catch((error) => {
  console.error("LỖI:", describeApiError(error));
  process.exit(1);
});
