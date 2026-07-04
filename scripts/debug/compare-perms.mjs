#!/usr/bin/env node
// So sánh danh sách permission (group/user) giữa nhiều item Drive.
// Usage: node scripts/compare-perms.mjs <ID> <ID> ...
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { google } from "googleapis";

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

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error("Cần ít nhất 1 ID.");
  const key = loadKey();
  const auth = new google.auth.JWT({
    email: key.clientEmail,
    key: key.privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
    subject: process.env.GOOGLE_ADMIN_IMPERSONATE_EMAIL,
  });
  const drive = google.drive({ version: "v3", auth });

  for (const id of ids) {
    try {
      const meta = await drive.files.get({ fileId: id, fields: "id,name,mimeType,owners(emailAddress)", supportsAllDrives: true });
      let perms = [];
      try {
        const r = await drive.permissions.list({
          fileId: id,
          supportsAllDrives: true,
          fields: "permissions(type,role,emailAddress,domain,permissionDetails(inherited))",
        });
        perms = r.data.permissions || [];
      } catch (e) {
        perms = null;
        var permErr = e?.errors?.[0]?.message || e?.message;
      }
      console.log(`\n■ ${meta.data.name}  [${id}]`);
      console.log(`  owner: ${(meta.data.owners || []).map((o) => o.emailAddress).join(", ") || "(?)"}`);
      if (perms === null) {
        console.log(`  permissions: KHÔNG ĐỌC ĐƯỢC (${permErr})`);
        continue;
      }
      const groups = perms.filter((p) => p.type === "group").map((p) => `${p.emailAddress} (${p.role}${p.permissionDetails?.[0]?.inherited ? ", kế thừa" : ""})`);
      const others = perms.filter((p) => p.type !== "group").map((p) => `${p.type}:${p.emailAddress || p.domain || "anyone"} (${p.role})`);
      console.log(`  GROUPS (${groups.length}): ${groups.join("  |  ") || "(không có)"}`);
      console.log(`  KHÁC   (${others.length}): ${others.join("  |  ") || "(không có)"}`);
    } catch (e) {
      console.log(`\n■ ${id}: LỖI ${e?.errors?.[0]?.message || e?.message}`);
    }
  }
}
main().catch((e) => {
  console.error("LỖI:", e?.message || String(e));
  process.exit(1);
});
