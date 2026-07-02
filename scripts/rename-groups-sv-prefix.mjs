#!/usr/bin/env node

// Đổi tiền tố email của các group folder (L1 + L2 ngoại ngữ) sang "sv-".
// Dùng Directory API groups.update đổi primary email; email cũ tự trở thành
// alias nên các share Drive và member hiện có vẫn giữ nguyên.
//
// Idempotent: nếu email cũ không còn (đã đổi) mà email mới đã tồn tại thì bỏ qua.
//
// Usage:
//   node scripts/rename-groups-sv-prefix.mjs            # LIVE
//   node scripts/rename-groups-sv-prefix.mjs --dry-run  # chỉ in, không ghi

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/admin.directory.group"];

// [oldLocal, newLocal]
const RENAMES = [
  // L1
  ["nn-toi-yeu-ngoai-ngu", "sv-toi-yeu-ngoai-ngu"],
  ["l1-sinh-vien-premium", "sv-sinh-vien-premium"],
  ["l1-tin-hoc-van-phong", "sv-tin-hoc-van-phong"],
  ["l1-cntt-lap-trinh", "sv-cntt-lap-trinh"],
  ["l1-dau-tu", "sv-dau-tu"],
  ["l1-thiet-ke", "sv-thiet-ke"],
  ["l1-vua-khoa-hoc", "sv-vua-khoa-hoc"],
  ["l1-dai-cuong-hcmut", "sv-dai-cuong-hcmut"],
  // L2 ngoại ngữ
  ["nn-ielts", "sv-ielts"],
  ["nn-tieng-nhat", "sv-tieng-nhat"],
  ["nn-tieng-han", "sv-tieng-han"],
  ["nn-tieng-trung", "sv-tieng-trung"],
  ["nn-toeic", "sv-toeic"],
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

async function exists(directory, email) {
  try {
    await directory.groups.get({ groupKey: email });
    return true;
  } catch (error) {
    if (error?.code === 404) return false;
    throw error;
  }
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

  console.log(`Domain      : ${domain}`);
  console.log(`Impersonate : ${impersonateEmail}`);
  console.log(`Số group    : ${RENAMES.length}`);
  console.log(dryRun ? "Mode        : DRY-RUN (không ghi)\n" : "Mode        : LIVE\n");

  const summary = { renamed: 0, alreadyDone: 0, errors: [] };

  let idx = 0;
  for (const [oldLocal, newLocal] of RENAMES) {
    idx++;
    const oldEmail = `${oldLocal}@${domain}`;
    const newEmail = `${newLocal}@${domain}`;
    process.stdout.write(`[${idx}/${RENAMES.length}] ${oldEmail} -> ${newEmail} ... `);
    try {
      const hasOld = await exists(directory, oldEmail);
      if (!hasOld) {
        const hasNew = await exists(directory, newEmail);
        if (hasNew) {
          summary.alreadyDone++;
          console.log("đã đổi trước đó");
        } else {
          summary.errors.push(`${oldEmail}: không tìm thấy cả email cũ lẫn mới`);
          console.log("LỖI: không tìm thấy group");
        }
        continue;
      }
      if (dryRun) {
        summary.renamed++;
        console.log("would-rename");
        continue;
      }
      await withRetry(
        () => directory.groups.update({ groupKey: oldEmail, requestBody: { email: newEmail } }),
        `update ${oldEmail}`,
      );
      summary.renamed++;
      console.log("renamed");
    } catch (error) {
      const msg = describeApiError(error);
      summary.errors.push(`${oldEmail}: ${msg}`);
      console.log(`LỖI: ${msg}`);
    }
  }

  console.log("\n========== TỔNG KẾT ==========");
  console.log(`Đã đổi          : ${summary.renamed}`);
  console.log(`Đã đổi từ trước : ${summary.alreadyDone}`);
  console.log(`Lỗi             : ${summary.errors.length}`);
  if (summary.errors.length) {
    console.log("\n--- Chi tiết lỗi ---");
    for (const e of summary.errors) console.log(" * " + e);
  }
  console.log("\nGhi chú: email cũ được giữ làm alias, share Drive & member không đổi.");
}

main().catch((error) => {
  console.error("LỖI:", describeApiError(error));
  process.exit(1);
});
