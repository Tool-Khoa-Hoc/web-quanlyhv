#!/usr/bin/env node

// Đổi "name" (tên hiển thị) của các group domain sang dạng dễ đọc, theo phong cách
// nhóm consumer: "[2K9] Môn - Giáo viên". Ghi qua Directory API groups.patch (chỉ field name).
// Idempotent: tên đã đúng thì bỏ qua.
//
// Dùng: node scripts/rename-groups.mjs
//       node scripts/rename-groups.mjs --dry-run

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { google } from "googleapis";

// slug (phần trước @) -> tên hiển thị mong muốn.
const NAMES = {
  "2k9-anh-full": "[2K9] Tiếng Anh - Full Giáo Viên",
  "2k9-anh-phamlieu-tens": "[2K9] Tiếng Anh - Cô Phạm Liễu (TENS)",
  "2k9-anh-tranganh-moon": "[2K9] Tiếng Anh - Cô Trang Anh (Moon)",
  "2k9-anh-vumaiphuong": "[2K9] Tiếng Anh - Cô Vũ Mai Phương",
  "2k9-combo-full": "[2K9] Combo - Full",
  "2k9-combo-thpt": "[2K9] Combo - THPT",
  "2k9-hoa-full": "[2K9] Hóa - Full Giáo Viên",
  "2k9-ly-full": "[2K9] Lý - Full Giáo Viên",
  "2k9-ly-vungochanh-mapstudy": "[2K9] Lý - Thầy Vũ Ngọc Hạnh (MapStudy)",
  "2k9-sinh-full": "[2K9] Sinh - Full Giáo Viên",
  "2k9-su-full": "[2K9] Sử - Full Giáo Viên",
  "2k9-su-nguyenhuongsen": "[2K9] Sử - Cô Nguyễn Hương Sen",
  "2k9-toan-dovanduc-tens": "[2K9] Toán - Thầy Đỗ Văn Đức (TENS)",
  "2k9-toan-dpad": "[2K9] Toán - DPAD",
  "2k9-toan-ful": "[2K9] Toán - Full Giáo Viên",
  "2k9-toan-giaokid": "[2K9] Toán - GIAOKID",
  "2k9-toan-mapstudy": "[2K9] Toán - MapStudy",
  "2k9-toan-ngochuyen": "[2K9] Toán - Cô Ngọc Huyền",
  "2k9-toan-nguyendangai-tdm": "[2K9] Toán - Thầy Nguyễn Đăng Ái (TDM)",
  "2k9-toan-nguyenphantien": "[2K9] Toán - Thầy Nguyễn Phan Tiến",
  "2k9-toan-shippertoan": "[2K9] Toán - Shipper Toán",
  "2k9-toan-thaychi": "[2K9] Toán - Thầy Chi",
  "2k9-tsa-hocmai": "[2K9] TSA - HOCMAI",
  "2k9-vact-empire": "[2K9] V-ACT - EMPIRE TEAM",
  "2k9-van-chilinh-tts": "[2K9] Văn - Chị Linh TTS",
  "2k9-van-full": "[2K9] Văn - Full Giáo Viên",
  "2k9-van-phamminhnhat": "[2K9] Văn - Thầy Phạm Minh Nhật",
  "2k9-van-suongmai": "[2K9] Văn - Cô Sương Mai",
  "2k9-van-tranthuyduong": "[2K9] Văn - Cô Trần Thuỳ Dương",
  "combo-2k9-xps-dtht": "[2K9] COMBO XPS DTHT",
  "hoc-thu-khoa-hoc": "Học Thử +Admin",
};

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
      if (g.email) groups.push({ email: g.email.toLowerCase(), name: g.name || "" });
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return groups;
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

  const summary = { renamed: 0, alreadyOk: 0, noMapping: [], errors: [] };

  let idx = 0;
  for (const g of groups) {
    idx++;
    const slug = g.email.split("@")[0];
    const desired = NAMES[slug];
    if (!desired) {
      summary.noMapping.push(g.email);
      console.log(`[${idx}/${groups.length}] ${g.email}: (không có trong bảng ánh xạ, bỏ qua)`);
      continue;
    }
    if (g.name === desired) {
      summary.alreadyOk++;
      console.log(`[${idx}/${groups.length}] ${g.email}: đã đúng "${desired}"`);
      continue;
    }
    if (dryRun) {
      console.log(`[${idx}/${groups.length}] ${g.email}: "${g.name}" -> "${desired}"`);
      summary.renamed++;
      continue;
    }
    try {
      await withRetry(
        () => directory.groups.patch({ groupKey: g.email, requestBody: { name: desired } }),
        `patch ${g.email}`,
      );
      summary.renamed++;
      console.log(`[${idx}/${groups.length}] ${g.email}: "${g.name}" -> "${desired}"`);
    } catch (error) {
      const msg = describeApiError(error);
      summary.errors.push(`${g.email}: ${msg}`);
      console.log(`[${idx}/${groups.length}] ${g.email}: LỖI ${msg}`);
    }
  }

  console.log("\n========== TỔNG KẾT ==========");
  console.log(`Đã đổi tên   : ${summary.renamed}`);
  console.log(`Đã đúng sẵn  : ${summary.alreadyOk}`);
  console.log(`Không ánh xạ : ${summary.noMapping.length}`);
  console.log(`Lỗi          : ${summary.errors.length}`);
  for (const e of summary.errors) console.log(" * " + e);
}

main().catch((error) => {
  console.error(describeApiError(error));
  process.exit(1);
});
