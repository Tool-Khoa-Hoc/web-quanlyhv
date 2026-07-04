#!/usr/bin/env node
// Liệt kê group trong domain, lọc theo từ khoá (regex, tuỳ chọn).
// Usage: node scripts/list-groups.mjs [keyword]
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
  const kw = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
  const key = loadKey();
  const auth = new google.auth.JWT({
    email: key.clientEmail,
    key: key.privateKey,
    scopes: ["https://www.googleapis.com/auth/admin.directory.group"],
    subject: process.env.GOOGLE_ADMIN_IMPERSONATE_EMAIL,
  });
  const dir = google.admin({ version: "directory_v1", auth });
  const domain = process.env.GOOGLE_WORKSPACE_DOMAIN;
  const out = [];
  let pt;
  do {
    const res = await dir.groups.list({ domain, maxResults: 200, pageToken: pt });
    for (const g of res.data.groups || []) out.push(g);
    pt = res.data.nextPageToken;
  } while (pt);
  const filtered = out.filter((g) => !kw || kw.test(g.email) || kw.test(g.name || ""));
  console.log(`Tổng ${out.length} group; khớp ${filtered.length}${kw ? ` với /${process.argv[2]}/i` : ""}:\n`);
  for (const g of filtered.sort((a, b) => a.email.localeCompare(b.email))) {
    console.log(`  ${g.email}   —   ${g.name || ""}   (members: ${g.directMembersCount ?? "?"})`);
  }
}
main().catch((e) => {
  console.error("LỖI:", e?.errors?.[0]?.message || e?.message || String(e));
  process.exit(1);
});
