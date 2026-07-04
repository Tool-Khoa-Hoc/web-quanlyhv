#!/usr/bin/env node

// Soi quyền share Drive của MỘT group: liệt kê mọi item được share trực tiếp cho
// group, rồi với từng folder cha có chứa item được share, liệt kê TẤT CẢ con để
// phát hiện "anh em lệch quyền" (vd: sheet xem được nhưng folder bài học A cùng
// cha lại không được share cho group).
//
// Nguyên nhân điển hình: share theo từng file thay vì share ở folder cha, nên
// item mới thêm (folder bài học A) bị bỏ sót → group không xem được.
//
// Usage:
//   node scripts/audit-group-drive-access.mjs --group 2k9-toan-dovanduc-tens@dautruonghoctap.io.vn
//   node scripts/audit-group-drive-access.mjs --group <email> --folder <FOLDER_ID>   # soi 1 folder cha cụ thể
//   node scripts/audit-group-drive-access.mjs --group <email> --fix --role reader --dry-run
//
// --fix : share cho group những con đang thiếu quyền (mặc định KHÔNG fix).

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive"];
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROLES = new Set(["reader", "commenter", "writer", "fileOrganizer", "organizer"]);

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
    const fallback = resolve(process.cwd(), "secrets/service-account.json");
    if (existsSync(fallback)) raw = readFileSync(fallback, "utf8");
    else throw new Error("Thiếu Service Account key.");
  }
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

const FILE_FIELDS =
  "id, name, mimeType, parents, owners(emailAddress), " +
  "permissions(id, type, role, emailAddress, deleted, permissionDetails(inherited, inheritedFrom, role))";

// Item được share TRỰC TIẾP cho group (không tính kế thừa).
function directGroupPerm(file, groupEmail) {
  const perms = file.permissions || [];
  const p = perms.find(
    (x) => x.type === "group" && x.emailAddress?.toLowerCase() === groupEmail && !x.deleted,
  );
  if (!p) return null;
  // permissionDetails.inherited === true => kế thừa từ cha, KHÔNG phải share trực tiếp.
  const det = p.permissionDetails?.[0];
  const inherited = det ? Boolean(det.inherited) : false;
  return { role: p.role, inherited };
}

// Group có xem được item không (trực tiếp HOẶC kế thừa).
function groupHasAccess(file, groupEmail) {
  const perms = file.permissions || [];
  return perms.some(
    (x) => x.type === "group" && x.emailAddress?.toLowerCase() === groupEmail && !x.deleted,
  );
}

async function searchSharedToGroup(drive, groupEmail) {
  const found = new Map();
  for (const coll of ["readers", "writers", "owners"]) {
    let pageToken;
    do {
      const res = await drive.files.list({
        q: `'${groupEmail}' in ${coll} and trashed = false`,
        fields: `nextPageToken, files(${FILE_FIELDS})`,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageSize: 200,
        pageToken,
        corpora: "allDrives",
      });
      for (const f of res.data.files || []) found.set(f.id, f);
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  return [...found.values()];
}

async function getFile(drive, fileId) {
  const res = await drive.files.get({
    fileId,
    fields: FILE_FIELDS,
    supportsAllDrives: true,
  });
  return res.data;
}

async function listChildren(drive, parentId) {
  const items = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: `nextPageToken, files(${FILE_FIELDS})`,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 200,
      pageToken,
      orderBy: "folder,name",
    });
    items.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return items;
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
      folder: { type: "string" },
      fix: { type: "boolean", default: false },
      role: { type: "string", default: "reader" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  const groupEmail = values.group?.trim().toLowerCase();
  if (!groupEmail) throw new Error("Thiếu --group <email>.");
  const fixRole = values.role?.trim();
  if (values.fix && !ROLES.has(fixRole)) {
    throw new Error(`--role không hợp lệ: ${fixRole}.`);
  }
  const dryRun = Boolean(values["dry-run"]);

  const impersonateEmail = requiredEnv("GOOGLE_ADMIN_IMPERSONATE_EMAIL");
  const key = loadServiceAccountKey();
  const auth = new google.auth.JWT({
    email: key.clientEmail,
    key: key.privateKey,
    scopes: SCOPES,
    subject: impersonateEmail,
  });
  const drive = google.drive({ version: "v3", auth });

  console.log(`Group       : ${groupEmail}`);
  console.log(`Impersonate : ${impersonateEmail}`);
  console.log(`Fix         : ${values.fix ? `YES (role=${fixRole}${dryRun ? ", DRY-RUN" : ""})` : "no (chỉ báo cáo)"}`);
  console.log("");

  // Xác định các folder cha cần soi.
  let parentFolders; // Map id -> {id, name}
  if (values.folder) {
    const f = await getFile(drive, values.folder.trim());
    parentFolders = new Map([[f.id, f]]);
  } else {
    console.log("Đang tìm mọi item được share trực tiếp cho group...");
    const shared = await searchSharedToGroup(drive, groupEmail);
    console.log(`→ ${shared.length} item được share trực tiếp cho group.\n`);

    // Tập hợp các folder-cha (parent) của những item được share, để soi anh em lệch quyền.
    parentFolders = new Map();
    for (const item of shared) {
      // Nếu chính item là folder đang được share → cũng soi con của nó.
      if (item.mimeType === FOLDER_MIME) parentFolders.set(item.id, item);
      for (const pid of item.parents || []) {
        if (!parentFolders.has(pid)) {
          try {
            const pf = await getFile(drive, pid);
            parentFolders.set(pid, pf);
          } catch {
            /* cha có thể ngoài phạm vi truy cập */
          }
        }
      }
    }
  }

  const anomalies = [];
  for (const parent of parentFolders.values()) {
    const children = await listChildren(drive, parent.id);
    if (!children.length) continue;

    const parentHas = groupHasAccess(parent, groupEmail);
    const rows = children.map((c) => ({
      c,
      access: groupHasAccess(c, groupEmail),
      direct: directGroupPerm(c, groupEmail),
    }));
    const withAccess = rows.filter((r) => r.access);
    const without = rows.filter((r) => !r.access);

    // Chỉ báo folder có sự lệch: một số con có quyền, một số con không.
    if (withAccess.length > 0 && without.length > 0) {
      console.log(`⚠️  LỆCH QUYỀN trong folder cha: ${parent.name} (${parent.id})`);
      console.log(`    Folder cha có share cho group? ${parentHas ? "CÓ" : "KHÔNG"}`);
      for (const r of rows) {
        const kind = r.c.mimeType === FOLDER_MIME ? "📁" : "📄";
        const mark = r.access ? "✅ xem được" : "❌ KHÔNG xem được";
        const how = r.direct
          ? r.direct.inherited
            ? "(kế thừa)"
            : "(share trực tiếp)"
          : "";
        console.log(`      ${kind} ${mark} ${how}  ${r.c.name}  [${r.c.id}]`);
        if (!r.access) anomalies.push({ parent, child: r.c });
      }
      console.log("");
    }
  }

  if (!anomalies.length) {
    console.log("✅ Không phát hiện con nào bị thiếu quyền so với anh em cùng cha.");
  } else {
    console.log(`\n========== TỔNG KẾT ==========`);
    console.log(`Số item thiếu quyền (anh em cùng cha đã có quyền): ${anomalies.length}`);
    for (const a of anomalies) {
      console.log(` * ${a.child.name} [${a.child.id}] trong "${a.parent.name}"`);
    }

    if (values.fix) {
      console.log(`\n--- FIX: share cho group với role=${fixRole} ---`);
      for (const a of anomalies) {
        if (dryRun) {
          console.log(`   [dry-run] would share ${a.child.name} [${a.child.id}]`);
          continue;
        }
        try {
          await shareToGroup(drive, a.child.id, groupEmail, fixRole);
          console.log(`   ✅ shared ${a.child.name} [${a.child.id}]`);
        } catch (error) {
          console.log(`   ❌ LỖI ${a.child.name}: ${describeApiError(error)}`);
        }
      }
    } else {
      console.log(`\nChạy lại với --fix --role reader để share bù (thêm --dry-run để xem trước).`);
    }
  }
}

main().catch((error) => {
  console.error("LỖI:", describeApiError(error));
  process.exit(1);
});
