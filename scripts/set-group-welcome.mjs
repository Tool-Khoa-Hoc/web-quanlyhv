#!/usr/bin/env node

// Đặt mô tả (description) cho TẤT CẢ group domain = đoạn chào mừng, có cá nhân hoá
// theo tên từng nhóm. Mô tả là dòng snippet hiển thị dưới tên group trên groups.google.com.
// Ghi qua Directory API groups.patch (field description). Idempotent.
//
// Dùng: node scripts/set-group-welcome.mjs
//       node scripts/set-group-welcome.mjs --dry-run

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { google } from "googleapis";

// {NAME} sẽ được thay bằng tên nhóm (đã bỏ tiền tố "[2K9] ").
const TEMPLATE = [
  "🎉 Chào mừng bạn đến với nhóm {NAME} - DAUTRUONGHOCTAP.IO.VN 🔥",
  "✅ OFFICIAL WEBSITE dautruonghoctap.io.vn",
  "💌 HƯỚNG DẪN HỌC ONLINE dautruonghoctap.io.vn/",
  "☑ CHECK UPDATE FIX HS KHOÁ HỌC ONLINE 2027 HỌC SINH dautruonghoctap.io.vn",
].join("\n");

const SCOPES = ["https://www.googleapis.com/auth/admin.directory.group"];

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
  const groups = [];
  let pageToken;
  do {
    const res = await withRetry(
      () => directory.groups.list({ domain, maxResults: 200, pageToken }),
      "groups.list",
    );
    for (const g of res.data.groups || []) {
      if (g.email)
        groups.push({
          email: g.email.toLowerCase(),
          name: g.name || "",
          description: g.description || "",
        });
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return groups;
}

function buildWelcome(name) {
  // Bỏ tiền tố "[2K9] " để câu chào đọc tự nhiên hơn.
  const clean = name.replace(/^\[2K9\]\s*/i, "").trim() || name;
  return TEMPLATE.replace("{NAME}", clean);
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

  console.log(`Domain : ${domain}`);
  console.log(dryRun ? "Mode   : DRY-RUN\n" : "Mode   : LIVE\n");

  const groups = await listAllGroups(directory, domain);
  console.log(`Tìm thấy ${groups.length} group.\n`);

  const summary = { set: 0, alreadyOk: 0, errors: [] };

  let idx = 0;
  for (const g of groups) {
    idx++;
    const desired = buildWelcome(g.name);
    if (g.description === desired) {
      summary.alreadyOk++;
      console.log(`[${idx}/${groups.length}] ${g.email}: đã đúng`);
      continue;
    }
    if (dryRun) {
      console.log(`[${idx}/${groups.length}] ${g.email}:\n${desired}\n`);
      summary.set++;
      continue;
    }
    try {
      await withRetry(
        () => directory.groups.patch({ groupKey: g.email, requestBody: { description: desired } }),
        `patch ${g.email}`,
      );
      summary.set++;
      console.log(`[${idx}/${groups.length}] ${g.email}: OK`);
    } catch (error) {
      const msg = describeApiError(error);
      summary.errors.push(`${g.email}: ${msg}`);
      console.log(`[${idx}/${groups.length}] ${g.email}: LỖI ${msg}`);
    }
  }

  console.log("\n========== TỔNG KẾT ==========");
  console.log(`Đã đặt mô tả : ${summary.set}`);
  console.log(`Đã đúng sẵn  : ${summary.alreadyOk}`);
  console.log(`Lỗi          : ${summary.errors.length}`);
  for (const e of summary.errors) console.log(" * " + e);
}

main().catch((error) => {
  console.error(describeApiError(error));
  process.exit(1);
});
