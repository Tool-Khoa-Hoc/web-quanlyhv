#!/usr/bin/env node
// Kiểm tra 1 group: settings hiển thị + bản ghi 1 thành viên cụ thể.
// Usage: node scripts/check-member.mjs <groupEmail> <memberEmail>
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/admin.directory.group.member",
  "https://www.googleapis.com/auth/apps.groups.settings",
];

function loadEnvFile(f) {
  const p = resolve(process.cwd(), f);
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
const err = (e) => `${e?.code ? `HTTP ${e.code}: ` : ""}${e?.errors?.[0]?.message || e?.message || String(e)}`;

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");
  const [groupEmail, memberEmail] = process.argv.slice(2);
  if (!groupEmail || !memberEmail) throw new Error("Usage: check-member.mjs <groupEmail> <memberEmail>");
  const key = loadKey();
  const auth = new google.auth.JWT({
    email: key.clientEmail,
    key: key.privateKey,
    scopes: SCOPES,
    subject: process.env.GOOGLE_ADMIN_IMPERSONATE_EMAIL,
  });
  const dir = google.admin({ version: "directory_v1", auth });
  const settings = google.groupssettings({ version: "v1", auth });

  console.log(`Group : ${groupEmail}`);
  console.log(`Member: ${memberEmail}\n`);

  // 1. Group metadata
  try {
    const g = await dir.groups.get({ groupKey: groupEmail });
    console.log(`Tên group        : ${g.data.name}`);
    console.log(`Tổng thành viên  : ${g.data.directMembersCount}`);
  } catch (e) {
    console.log(`Group meta LỖI: ${err(e)}`);
  }

  // 2. Settings hiển thị
  try {
    const s = await settings.groups.get({ groupUniqueId: groupEmail, alt: "json" });
    const d = s.data;
    console.log(`\n--- Settings hiển thị ---`);
    for (const f of ["whoCanViewGroup", "whoCanViewMembership", "whoCanDiscoverGroup", "showInGroupDirectory", "allowExternalMembers", "whoCanJoin", "whoCanModerateMembers"]) {
      console.log(`  ${f} = ${d[f]}`);
    }
  } catch (e) {
    console.log(`Settings LỖI: ${err(e)}`);
  }

  // 3. Bản ghi thành viên
  try {
    const m = await dir.members.get({ groupKey: groupEmail, memberKey: memberEmail });
    console.log(`\n--- Bản ghi thành viên ---`);
    console.log(`  email         : ${m.data.email}`);
    console.log(`  role          : ${m.data.role}`);
    console.log(`  type          : ${m.data.type}`);
    console.log(`  status        : ${m.data.status}`);
    console.log(`  delivery      : ${m.data.delivery_settings}`);
    console.log(`  id            : ${m.data.id}`);
  } catch (e) {
    console.log(`\n--- Bản ghi thành viên ---`);
    console.log(`  KHÔNG TÌM THẤY hoặc lỗi: ${err(e)}`);
  }
}
main().catch((e) => {
  console.error("LỖI:", err(e));
  process.exit(1);
});
