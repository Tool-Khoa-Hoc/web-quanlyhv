#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/drive",
];

const ROLES = new Set(["reader", "commenter", "writer", "fileOrganizer", "organizer"]);

function loadEnvFile(fileName) {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return;

  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalIndex = trimmed.indexOf("=");
    if (equalIndex < 0) continue;

    const key = trimmed.slice(0, equalIndex).trim();
    let value = trimmed.slice(equalIndex + 1).trim();
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
  if (inline) {
    raw = inline;
  } else if (base64) {
    raw = Buffer.from(base64, "base64").toString("utf8");
  } else if (filePath) {
    raw = readFileSync(filePath, "utf8");
  } else {
    throw new Error(
      "Thiếu Service Account key. Đặt GOOGLE_ADMIN_SA_KEY_BASE64, GOOGLE_ADMIN_SA_KEY hoặc GOOGLE_ADMIN_SA_KEY_FILE.",
    );
  }

  const key = JSON.parse(raw);
  if (!key.client_email || !key.private_key) {
    throw new Error("Service Account key thiếu client_email hoặc private_key.");
  }

  return {
    clientEmail: key.client_email,
    privateKey: key.private_key.replace(/\\n/g, "\n"),
  };
}

function usage() {
  return `
Tạo Google Group rồi share Drive file/folder/shared drive cho group đó.

Usage:
  npm run create-group-share-drive -- --group-email khoa-toan@dautruonghoctap.io.vn --drive-id DRIVE_FILE_OR_FOLDER_ID [options]

Options:
  --group-email       Email group trong Workspace domain. Bắt buộc.
  --group-name        Tên hiển thị của group. Mặc định lấy từ group email.
  --description       Mô tả group.
  --drive-id          ID file/folder/shared drive cần share. Bắt buộc.
  --role              reader | commenter | writer | fileOrganizer | organizer. Mặc định: reader.
  --notify            Gửi email thông báo share cho group.
  --dry-run           In thao tác sẽ làm, không gọi API.
  --help              Hiện hướng dẫn này.

Ví dụ:
  npm run create-group-share-drive -- --group-email 2k9-toan@dautruonghoctap.io.vn --group-name "2K9 Toán" --drive-id 1AbCFolderId --role reader
`;
}

function getCliOptions() {
  const { values } = parseArgs({
    options: {
      "group-email": { type: "string" },
      "group-name": { type: "string" },
      description: { type: "string" },
      "drive-id": { type: "string" },
      role: { type: "string", default: "reader" },
      notify: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(usage());
    process.exit(0);
  }

  const groupEmail = values["group-email"]?.trim().toLowerCase();
  const driveId = values["drive-id"]?.trim();
  const role = values.role?.trim();

  if (!groupEmail || !driveId) {
    throw new Error(`Thiếu --group-email hoặc --drive-id.\n${usage()}`);
  }
  if (!ROLES.has(role)) {
    throw new Error(`Role không hợp lệ: ${role}. Dùng một trong: ${Array.from(ROLES).join(", ")}.`);
  }

  return {
    groupEmail,
    groupName: values["group-name"]?.trim() || groupEmail.split("@")[0],
    description: values.description?.trim() || "",
    driveId,
    role,
    notify: Boolean(values.notify),
    dryRun: Boolean(values["dry-run"]),
  };
}

function describeApiError(error) {
  const message = error?.errors?.[0]?.message || error?.message || String(error);
  const code = error?.code ? `HTTP ${error.code}: ` : "";
  return `${code}${message}`;
}

async function ensureGroup(directory, { groupEmail, groupName, description, dryRun }) {
  try {
    const existing = await directory.groups.get({ groupKey: groupEmail });
    return {
      created: false,
      group: existing.data,
    };
  } catch (error) {
    if (error?.code !== 404) throw error;
  }

  if (dryRun) {
    return {
      created: true,
      group: { email: groupEmail, name: groupName, description },
    };
  }

  const created = await directory.groups.insert({
    requestBody: {
      email: groupEmail,
      name: groupName,
      description,
    },
  });

  return {
    created: true,
    group: created.data,
  };
}

async function ensureDrivePermission(drive, { driveId, groupEmail, role, notify, dryRun }) {
  let existing;
  try {
    const permissions = await drive.permissions.list({
      fileId: driveId,
      supportsAllDrives: true,
      useDomainAdminAccess: true,
      fields: "permissions(id,type,role,emailAddress)",
    });

    existing = permissions.data.permissions?.find(
      (permission) =>
        permission.type === "group" && permission.emailAddress?.toLowerCase() === groupEmail,
    );
  } catch (error) {
    if (error?.code !== 404) throw error;
  }

  if (dryRun) {
    return {
      action: existing ? "update-existing-permission" : "create-permission",
      permission: existing ?? { type: "group", role, emailAddress: groupEmail },
    };
  }

  if (existing) {
    if (existing.role === role) {
      return { action: "already-shared", permission: existing };
    }

    const updated = await drive.permissions.update({
      fileId: driveId,
      permissionId: existing.id,
      supportsAllDrives: true,
      useDomainAdminAccess: true,
      fields: "id,type,role,emailAddress",
      requestBody: { role },
    });
    return { action: "updated-permission", permission: updated.data };
  }

  const created = await drive.permissions.create({
    fileId: driveId,
    supportsAllDrives: true,
    useDomainAdminAccess: true,
    sendNotificationEmail: notify,
    fields: "id,type,role,emailAddress",
    requestBody: {
      type: "group",
      role,
      emailAddress: groupEmail,
    },
  });

  return { action: "created-permission", permission: created.data };
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const options = getCliOptions();
  const domain = requiredEnv("GOOGLE_WORKSPACE_DOMAIN");
  const impersonateEmail = requiredEnv("GOOGLE_ADMIN_IMPERSONATE_EMAIL");

  if (!options.groupEmail.endsWith(`@${domain}`)) {
    throw new Error(`Group email phải thuộc domain ${domain}: ${options.groupEmail}`);
  }

  const key = loadServiceAccountKey();
  const auth = new google.auth.JWT({
    email: key.clientEmail,
    key: key.privateKey,
    scopes: SCOPES,
    subject: impersonateEmail,
  });

  const directory = google.admin({ version: "directory_v1", auth });
  const drive = google.drive({ version: "v3", auth });

  console.log(`Domain: ${domain}`);
  console.log(`Impersonate: ${impersonateEmail}`);
  console.log(`Group: ${options.groupEmail}`);
  console.log(`Drive target: ${options.driveId}`);
  console.log(`Role: ${options.role}`);
  if (options.dryRun) console.log("Mode: dry-run, không gọi API ghi dữ liệu.");

  const groupResult = await ensureGroup(directory, options);
  console.log(groupResult.created ? "Group: created" : "Group: already exists");

  const shareResult = await ensureDrivePermission(drive, options);
  console.log(`Drive permission: ${shareResult.action}`);
  console.log(JSON.stringify(shareResult.permission, null, 2));
}

main().catch((error) => {
  console.error(describeApiError(error));
  process.exit(1);
});
