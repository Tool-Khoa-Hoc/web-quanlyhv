#!/usr/bin/env node

// Đọc cây thư mục Drive (folder con + file) bằng Service Account, in JSON.
// Dùng để map folder -> group trước khi tạo group/share Drive.
//
// Usage:
//   node scripts/list-drive-tree.mjs --root <FOLDER_ID> [--depth 2]

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { google } from "googleapis";

// Domain-wide delegation khớp chính xác chuỗi scope; SA này được uỷ quyền scope
// "drive" (full) như create-group-share-drive.mjs, KHÔNG có drive.readonly.
const SCOPES = ["https://www.googleapis.com/auth/drive"];
const FOLDER_MIME = "application/vnd.google-apps.folder";

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
    // Đường dẫn trong .env có thể bị mojibake; fallback sang ./secrets/service-account.json.
    if (!existsSync(filePath)) {
      const fallback = resolve(process.cwd(), "secrets/service-account.json");
      if (existsSync(fallback)) filePath = fallback;
    }
    raw = readFileSync(filePath, "utf8");
  } else {
    throw new Error("Thiếu Service Account key.");
  }
  const key = JSON.parse(raw);
  if (!key.client_email || !key.private_key) {
    throw new Error("Service Account key thiếu client_email hoặc private_key.");
  }
  return { clientEmail: key.client_email, privateKey: key.private_key.replace(/\\n/g, "\n") };
}

async function listChildren(drive, parentId) {
  const items = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 200,
      pageToken,
      orderBy: "folder,name",
    });
    items.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return items;
}

async function walk(drive, folderId, depth, maxDepth) {
  const children = await listChildren(drive, folderId);
  const result = [];
  for (const child of children) {
    const isFolder = child.mimeType === FOLDER_MIME;
    const node = { id: child.id, name: child.name, folder: isFolder };
    if (isFolder && depth < maxDepth) {
      node.children = await walk(drive, child.id, depth + 1, maxDepth);
    }
    result.push(node);
  }
  return result;
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      depth: { type: "string", default: "2" },
    },
  });
  const root = values.root?.trim();
  if (!root) throw new Error("Thiếu --root <FOLDER_ID>.");
  const maxDepth = Number(values.depth) || 2;

  const impersonateEmail = requiredEnv("GOOGLE_ADMIN_IMPERSONATE_EMAIL");
  const key = loadServiceAccountKey();
  const auth = new google.auth.JWT({
    email: key.clientEmail,
    key: key.privateKey,
    scopes: SCOPES,
    subject: impersonateEmail,
  });
  const drive = google.drive({ version: "v3", auth });

  const rootMeta = await drive.files.get({
    fileId: root,
    fields: "id, name, mimeType",
    supportsAllDrives: true,
  });
  const tree = await walk(drive, root, 1, maxDepth);
  console.log(
    JSON.stringify({ root: { id: rootMeta.data.id, name: rootMeta.data.name }, tree }, null, 2),
  );
}

main().catch((error) => {
  const message = error?.errors?.[0]?.message || error?.message || String(error);
  console.error("LỖI:", message);
  process.exit(1);
});
