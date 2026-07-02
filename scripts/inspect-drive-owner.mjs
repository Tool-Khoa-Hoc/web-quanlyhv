#!/usr/bin/env node

// Kiểm tra chủ sở hữu + khả năng share của các folder (qua impersonation).
// Dùng để biết nên impersonate ai mới share được.
//
// Usage: node scripts/inspect-drive-owner.mjs <FOLDER_ID> [FOLDER_ID...]

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive"];

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
  } else {
    throw new Error("Thiếu Service Account key.");
  }
  const key = JSON.parse(raw);
  return { clientEmail: key.client_email, privateKey: key.private_key.replace(/\\n/g, "\n") };
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const folderIds = process.argv.slice(2);
  if (!folderIds.length) throw new Error("Cần ít nhất 1 FOLDER_ID.");

  const impersonateEmail = requiredEnv("GOOGLE_ADMIN_IMPERSONATE_EMAIL");
  const key = loadServiceAccountKey();
  const auth = new google.auth.JWT({
    email: key.clientEmail,
    key: key.privateKey,
    scopes: SCOPES,
    subject: impersonateEmail,
  });
  const drive = google.drive({ version: "v3", auth });

  console.log(`Impersonate: ${impersonateEmail}\n`);
  for (const id of folderIds) {
    try {
      const res = await drive.files.get({
        fileId: id,
        fields:
          "id, name, driveId, owners(emailAddress,displayName), capabilities(canShare,canEdit), permissions(type,role,emailAddress)",
        supportsAllDrives: true,
      });
      const d = res.data;
      console.log(`Folder: ${d.name} (${d.id})`);
      console.log(`  driveId      : ${d.driveId ?? "(My Drive, không phải Shared Drive)"}`);
      console.log(
        `  owners       : ${(d.owners ?? []).map((o) => o.emailAddress).join(", ") || "(không có - Shared Drive)"}`,
      );
      console.log(`  canShare     : ${d.capabilities?.canShare}`);
      console.log(`  canEdit      : ${d.capabilities?.canEdit}`);
      console.log("");
    } catch (error) {
      const msg = error?.errors?.[0]?.message || error?.message || String(error);
      console.log(`Folder ${id}: LỖI ${error?.code ?? ""} ${msg}\n`);
    }
  }
}

main().catch((error) => {
  console.error("LỖI:", error?.message || String(error));
  process.exit(1);
});
