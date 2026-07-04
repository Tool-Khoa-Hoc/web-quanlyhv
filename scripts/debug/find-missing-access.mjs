#!/usr/bin/env node

// Duyệt TOÀN BỘ cây con dưới 1 folder gốc, kiểm tra quyền hiệu lực (effective,
// gồm cả kế thừa) của MỘT group trên từng item bằng permissions.list +
// useDomainAdminAccess (chính xác hơn files.list). Báo cáo mọi item group KHÔNG
// xem được — đây là các "folder bài học/sheet bị bỏ sót khi share".
//
// Với folder không có quyền: coi là ĐIỂM GÃY, báo cáo và KHÔNG duyệt sâu thêm
// (cả subtree bên dưới cũng mất quyền theo). Với folder có quyền: duyệt tiếp.
//
// Usage:
//   node scripts/find-missing-access.mjs --group <email> --root <FOLDER_ID>
//   node scripts/find-missing-access.mjs --group <email> --root <ID> --fix --role reader [--dry-run]

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive"];
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROLES = new Set(["reader", "commenter", "writer", "fileOrganizer", "organizer"]);

function loadEnvFile(fileName) {
  const p = resolve(process.cwd(), fileName);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (!k || process.env[k]) continue;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[k] = v;
  }
}
function requiredEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Thiếu biến môi trường ${name}.`);
  return v;
}
function loadKey() {
  let fp = process.env.GOOGLE_ADMIN_SA_KEY_FILE?.trim();
  let raw;
  if (process.env.GOOGLE_ADMIN_SA_KEY_BASE64) raw = Buffer.from(process.env.GOOGLE_ADMIN_SA_KEY_BASE64, "base64").toString("utf8");
  else {
    if (!fp || !existsSync(fp)) fp = resolve(process.cwd(), "secrets/service-account.json");
    raw = readFileSync(fp, "utf8");
  }
  const k = JSON.parse(raw);
  return { clientEmail: k.client_email, privateKey: k.private_key.replace(/\\n/g, "\n") };
}
function apiErr(e) {
  return `${e?.code ? `HTTP ${e.code}: ` : ""}${e?.errors?.[0]?.message || e?.message || String(e)}`;
}

async function listChildren(drive, parentId) {
  const items = [];
  let pt;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id,name,mimeType)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 200,
      pageToken: pt,
      orderBy: "folder,name",
    });
    items.push(...(res.data.files || []));
    pt = res.data.nextPageToken ?? undefined;
  } while (pt);
  return items;
}

// Dựng tập ID mà group ĐỌC ĐƯỢC theo chỉ mục hiệu lực của Google (gồm cả kế
// thừa). Đây là nguồn đáng tin nhất khi file do tài khoản ngoài domain sở hữu
// (không dùng được useDomainAdminAccess).
async function buildReadableSet(drive, groupEmail) {
  const set = new Set();
  for (const coll of ["readers", "writers", "owners"]) {
    let pt;
    do {
      const res = await drive.files.list({
        q: `'${groupEmail}' in ${coll} and trashed = false`,
        fields: "nextPageToken, files(id)",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: "allDrives",
        pageSize: 200,
        pageToken: pt,
      });
      for (const f of res.data.files || []) set.add(f.id);
      pt = res.data.nextPageToken ?? undefined;
    } while (pt);
  }
  return set;
}

async function shareToGroup(drive, fileId, groupEmail, role) {
  await drive.permissions.create({
    fileId,
    supportsAllDrives: true,
    sendNotificationEmail: false,
    fields: "id",
    requestBody: { type: "group", role, emailAddress: groupEmail },
  });
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");
  const { values } = parseArgs({
    options: {
      group: { type: "string" },
      root: { type: "string" },
      fix: { type: "boolean", default: false },
      role: { type: "string", default: "reader" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const group = values.group?.trim().toLowerCase();
  const root = values.root?.trim();
  if (!group || !root) throw new Error("Cần --group <email> và --root <FOLDER_ID>.");
  const role = values.role?.trim();
  if (values.fix && !ROLES.has(role)) throw new Error(`--role không hợp lệ: ${role}.`);
  const dryRun = Boolean(values["dry-run"]);

  const key = loadKey();
  const auth = new google.auth.JWT({
    email: key.clientEmail,
    key: key.privateKey,
    scopes: SCOPES,
    subject: requiredEnv("GOOGLE_ADMIN_IMPERSONATE_EMAIL"),
  });
  const drive = google.drive({ version: "v3", auth });

  const rootMeta = await drive.files.get({ fileId: root, fields: "id,name,mimeType", supportsAllDrives: true });
  console.log(`Group : ${group}`);
  console.log(`Root  : ${rootMeta.data.name} [${root}]`);
  console.log(`Fix   : ${values.fix ? `YES role=${role}${dryRun ? " DRY-RUN" : ""}` : "no"}\n`);

  console.log("Đang dựng tập item group đọc được...");
  const readable = await buildReadableSet(drive, group);
  console.log(`→ group đọc được ${readable.size} item.\n`);

  const missing = []; // {name, id, mimeType, isFolder, parentName}
  let scanned = 0;

  async function walk(folderId, folderName) {
    const children = await listChildren(drive, folderId);
    for (const c of children) {
      scanned++;
      const isFolder = c.mimeType === FOLDER_MIME;
      if (!readable.has(c.id)) {
        missing.push({ ...c, isFolder, parentName: folderName });
        // folder mất quyền = điểm gãy, không duyệt sâu (subtree cũng mất theo).
        continue;
      }
      if (isFolder) await walk(c.id, c.name);
    }
  }

  await walk(root, rootMeta.data.name);

  console.log(`Đã quét ${scanned} item.\n`);
  if (!missing.length) {
    console.log("✅ Mọi item dưới folder gốc đều đã có quyền cho group.");
    return;
  }

  console.log(`❌ Có ${missing.length} item group KHÔNG xem được:\n`);
  for (const m of missing) {
    const ic = m.isFolder ? "📁 FOLDER" : "📄 file  ";
    console.log(`  ${ic}  ${m.name}`);
    console.log(`            trong: ${m.parentName}`);
    console.log(`            id   : ${m.id}`);
  }

  if (values.fix) {
    console.log(`\n--- FIX: share cho group role=${role} ---`);
    for (const m of missing) {
      if (dryRun) {
        console.log(`   [dry-run] ${m.name} [${m.id}]`);
        continue;
      }
      try {
        await shareToGroup(drive, m.id, group, role);
        console.log(`   ✅ ${m.name} [${m.id}]`);
      } catch (e) {
        console.log(`   ❌ ${m.name}: ${apiErr(e)}`);
      }
    }
  } else {
    console.log(`\nChạy lại với --fix --role reader để cấp quyền bù (thêm --dry-run để xem trước).`);
  }
}

main().catch((e) => {
  console.error("LỖI:", apiErr(e));
  process.exit(1);
});
