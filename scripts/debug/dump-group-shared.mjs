#!/usr/bin/env node
// Dump mọi item share trực tiếp cho group: name | type | id | parents(name)
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive"];
const FOLDER_MIME = "application/vnd.google-apps.folder";

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

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");
  const { values } = parseArgs({ options: { group: { type: "string" } } });
  const group = values.group?.trim().toLowerCase();
  const key = loadKey();
  const auth = new google.auth.JWT({
    email: key.clientEmail,
    key: key.privateKey,
    scopes: SCOPES,
    subject: process.env.GOOGLE_ADMIN_IMPERSONATE_EMAIL,
  });
  const drive = google.drive({ version: "v3", auth });

  const map = new Map();
  for (const coll of ["readers", "writers", "owners"]) {
    let pt;
    do {
      const res = await drive.files.list({
        q: `'${group}' in ${coll} and trashed = false`,
        fields: "nextPageToken, files(id,name,mimeType,parents)",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: "allDrives",
        pageSize: 200,
        pageToken: pt,
      });
      for (const f of res.data.files || []) map.set(f.id, f);
      pt = res.data.nextPageToken ?? undefined;
    } while (pt);
  }
  const items = [...map.values()];

  // Lấy tên các parent để gom nhóm.
  const nameCache = new Map();
  async function nameOf(id) {
    if (nameCache.has(id)) return nameCache.get(id);
    try {
      const r = await drive.files.get({ fileId: id, fields: "id,name", supportsAllDrives: true });
      nameCache.set(id, r.data.name);
      return r.data.name;
    } catch {
      nameCache.set(id, "(?)");
      return "(?)";
    }
  }

  // Gom theo parent.
  const byParent = new Map();
  for (const f of items) {
    for (const pid of f.parents || ["(no-parent)"]) {
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(f);
    }
  }

  console.log(`Group: ${group}  | tổng ${items.length} item share trực tiếp\n`);
  for (const [pid, list] of byParent) {
    const pname = pid === "(no-parent)" ? "(no-parent)" : await nameOf(pid);
    console.log(`▼ PARENT: ${pname}  [${pid}]  (${list.length} item share)`);
    for (const f of list.sort((a, b) => a.name.localeCompare(b.name))) {
      const ic = f.mimeType === FOLDER_MIME ? "📁" : f.mimeType.includes("spreadsheet") ? "📊" : "📄";
      console.log(`    ${ic} ${f.name}  [${f.id}]`);
    }
    console.log("");
  }
}
main().catch((e) => {
  console.error("LỖI:", e?.errors?.[0]?.message || e?.message || String(e));
  process.exit(1);
});
