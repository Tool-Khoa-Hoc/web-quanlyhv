#!/usr/bin/env node

// Bật "cho phép thành viên ngoài domain" (allowExternalMembers = true) cho hàng loạt group.
// Dùng Groups Settings API. Đọc danh sách group từ cùng file TSV (cột 1 = local-part/email).

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/apps.groups.settings"];

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

function parseGroupList(filePath, domain) {
  const raw = readFileSync(filePath, "utf8");
  const groups = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    let group = trimmed.split(/\t+/)[0].trim().toLowerCase();
    if (!group) continue;
    if (group.includes("@")) group = group.split("@")[0];
    groups.add(`${group}@${domain}`);
  }
  return [...groups];
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  const gs = google.groupssettings({ version: "v1", auth });

  const groups = parseGroupList(dataFile, domain);
  console.log(`Domain      : ${domain}`);
  console.log(`Số group    : ${groups.length}`);
  console.log(dryRun ? "Mode        : DRY-RUN\n" : "Mode        : LIVE\n");

  const summary = { updated: 0, errors: [] };
  let idx = 0;
  for (const groupEmail of groups) {
    idx++;
    process.stdout.write(`[${idx}/${groups.length}] ${groupEmail} ... `);
    if (dryRun) {
      console.log("would-set allowExternalMembers=true");
      summary.updated++;
      continue;
    }
    try {
      await gs.groups.patch({
        groupUniqueId: groupEmail,
        requestBody: { allowExternalMembers: "true" },
      });
      console.log("allowExternalMembers=true ✓");
      summary.updated++;
    } catch (error) {
      const msg = describeApiError(error);
      console.log(`LỖI ${msg}`);
      summary.errors.push(`${groupEmail}: ${msg}`);
      // backoff nhẹ nếu rate limit
      if (error?.code === 403 || error?.code === 429) await sleep(1500);
    }
  }

  console.log("\n========== TỔNG KẾT ==========");
  console.log(`Đã set OK : ${summary.updated}`);
  console.log(`Lỗi       : ${summary.errors.length}`);
  if (summary.errors.length) {
    console.log("\n--- Chi tiết lỗi ---");
    for (const e of summary.errors) console.log(" * " + e);
  }
}

main().catch((error) => {
  console.error(describeApiError(error));
  process.exit(1);
});
