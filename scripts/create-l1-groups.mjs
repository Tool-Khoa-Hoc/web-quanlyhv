#!/usr/bin/env node

// Tạo group cho TẤT CẢ folder cấp 1 trong "Trạm Sinh Viên" rồi share folder
// tương ứng cho từng group với quyền reader (mỗi group share đúng folder cha,
// bao trùm toàn bộ khóa con bên trong).
//
// Idempotent: group đã tồn tại thì bỏ qua tạo; share đã đúng quyền thì bỏ qua.
//
// Usage:
//   node scripts/create-l1-groups.mjs            # LIVE
//   node scripts/create-l1-groups.mjs --dry-run  # chỉ in, không ghi

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/drive",
];

const DRIVE_ROLE = "reader";

// localpart (sẽ nối @domain) -> { name, folders[] }.
const GROUPS = [
  { local: "nn-toi-yeu-ngoai-ngu", name: "Tôi yêu ngoại ngữ", folders: ["1y35CZvcq-v2a-cyl_Zxo-0NG85WTDsbF"] },
  { local: "l1-sinh-vien-premium", name: "Combo Sinh Viên Premium", folders: ["1dmeVLexfh-KalNMDW0TmAJqL0XBfPXc1"] },
  { local: "l1-tin-hoc-van-phong", name: "Combo Tin Học Văn Phòng", folders: ["1tGq-Ikf5YISH5a4qKCaaIrQmemBvYd4m"] },
  { local: "l1-cntt-lap-trinh", name: "Combo CNTT và Lập Trình", folders: ["1qd8Ske6e2VCWtBQckGSD_vJyOa-kYb2E"] },
  { local: "l1-dau-tu", name: "Combo Khóa Học Đầu Tư", folders: ["1HPGY_0vAdJw_tNhlr3U1ytDMtwb5FLPf"] },
  { local: "l1-thiet-ke", name: "Combo Thiết Kế Đa Năng", folders: ["1GD5hFup0vnFF7-mohFeToIx5OqkICZJp"] },
  { local: "l1-vua-khoa-hoc", name: "Combo Vua Khóa Học", folders: ["1Vrm9ml3rUZmCHwoAKJdQsrOU1dCOPUD2"] },
  { local: "l1-dai-cuong-hcmut", name: "Combo Đại Cương HCMUT", folders: ["1jt7i5Vru_zsW_3TsfA0IIbUfx-t6gIZ9"] },
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

async function ensureGroup(directory, groupEmail, name, dryRun) {
  try {
    await directory.groups.get({ groupKey: groupEmail });
    return "exists";
  } catch (error) {
    if (error?.code !== 404) throw error;
  }
  if (dryRun) return "would-create";
  await withRetry(
    () => directory.groups.insert({ requestBody: { email: groupEmail, name } }),
    `insert group ${groupEmail}`,
  );
  return "created";
}

async function ensureShare(drive, folderId, groupEmail, dryRun) {
  let existing;
  try {
    const res = await drive.permissions.list({
      fileId: folderId,
      supportsAllDrives: true,
      fields: "permissions(id,type,role,emailAddress)",
    });
    existing = res.data.permissions?.find(
      (p) => p.type === "group" && p.emailAddress?.toLowerCase() === groupEmail,
    );
  } catch (error) {
    if (error?.code !== 404) throw error;
  }

  if (existing) {
    if (existing.role === DRIVE_ROLE) return "already-shared";
    if (dryRun) return "would-update";
    await withRetry(
      () =>
        drive.permissions.update({
          fileId: folderId,
          permissionId: existing.id,
          supportsAllDrives: true,
          requestBody: { role: DRIVE_ROLE },
        }),
      `update perm ${groupEmail} -> ${folderId}`,
    );
    return "updated";
  }

  if (dryRun) return "would-share";
  await withRetry(
    () =>
      drive.permissions.create({
        fileId: folderId,
        supportsAllDrives: true,
        sendNotificationEmail: false,
        requestBody: { type: "group", role: DRIVE_ROLE, emailAddress: groupEmail },
      }),
    `share ${groupEmail} -> ${folderId}`,
  );
  return "shared";
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
  const drive = google.drive({ version: "v3", auth });

  console.log(`Domain      : ${domain}`);
  console.log(`Impersonate : ${impersonateEmail}`);
  console.log(`Số group    : ${GROUPS.length}`);
  console.log(`Drive role  : ${DRIVE_ROLE}`);
  console.log(dryRun ? "Mode        : DRY-RUN (không gọi API ghi)\n" : "Mode        : LIVE\n");

  const summary = { groupsCreated: 0, groupsExisted: 0, shared: 0, alreadyShared: 0, errors: [] };

  let idx = 0;
  for (const g of GROUPS) {
    idx++;
    const groupEmail = `${g.local}@${domain}`;
    process.stdout.write(`[${idx}/${GROUPS.length}] ${groupEmail} ("${g.name}") ... `);
    let gState;
    try {
      gState = await ensureGroup(directory, groupEmail, g.name, dryRun);
    } catch (error) {
      const msg = describeApiError(error);
      console.log(`LỖI tạo group: ${msg}`);
      summary.errors.push(`group ${groupEmail}: ${msg}`);
      continue;
    }
    if (gState === "created" || gState === "would-create") summary.groupsCreated++;
    else summary.groupsExisted++;
    console.log(gState);

    if (gState === "created") await sleep(1500); // chờ group propagate trước khi share

    for (const folderId of g.folders) {
      try {
        const sState = await ensureShare(drive, folderId, groupEmail, dryRun);
        if (sState === "shared" || sState === "would-share" || sState === "updated" || sState === "would-update")
          summary.shared++;
        else summary.alreadyShared++;
        console.log(`     - folder ${folderId}: ${sState}`);
      } catch (error) {
        const msg = describeApiError(error);
        console.log(`     - folder ${folderId}: LỖI ${msg}`);
        summary.errors.push(`share ${groupEmail} -> ${folderId}: ${msg}`);
      }
    }
  }

  console.log("\n========== TỔNG KẾT ==========");
  console.log(`Group tạo mới   : ${summary.groupsCreated}`);
  console.log(`Group đã có     : ${summary.groupsExisted}`);
  console.log(`Share Drive     : ${summary.shared}`);
  console.log(`Đã share sẵn    : ${summary.alreadyShared}`);
  console.log(`Lỗi             : ${summary.errors.length}`);
  if (summary.errors.length) {
    console.log("\n--- Chi tiết lỗi ---");
    for (const e of summary.errors) console.log(" * " + e);
  }
}

main().catch((error) => {
  console.error("LỖI:", describeApiError(error));
  process.exit(1);
});
