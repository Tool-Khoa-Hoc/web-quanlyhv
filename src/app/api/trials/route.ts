import { NextResponse } from "next/server";

import {
  describeApiError,
  ensureGroupMember,
  ensureSheetHocDthtMember,
  getCtvTrialGroupKeys,
  getDirectory,
} from "@/lib/google-admin";
import { rejectCrossSiteMutation, requireGroupAccess, requireSession } from "@/lib/api-guard";
import { recordCtvActivity } from "@/lib/activity-store";
import {
  checkRateLimit,
  isJsonBodyTooLarge,
  isValidEmail,
  isValidGroupKey,
  normalizeEmail,
  rateLimitKey,
} from "@/lib/validation";
import { KvStoreError } from "@/lib/kv";
import {
  TrialStoreError,
  isTrialStoreConfigured,
  listTrialRecords,
  updateTrialStatus,
  upsertTrialRecord,
} from "@/lib/trial-store";
import type { ApiMember, ApiGroupRole } from "@/lib/admin-types";

export const dynamic = "force-dynamic";

const VALID_STATUS = ["dang_thu", "da_dang_ky", "khong_dang_ky"];

function handleError(error: unknown) {
  if (error instanceof TrialStoreError || error instanceof KvStoreError) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
  const { status, message } = describeApiError(error);
  return NextResponse.json({ error: message }, { status });
}

// GET /api/trials → danh sách record học thử (đồng bộ chung).
//  - Admin: tất cả. CTV: chỉ nhóm học thử của họ (fail-closed nếu chưa cấu hình).
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  if (!isTrialStoreConfigured()) return NextResponse.json({ records: [] });
  try {
    const records = await listTrialRecords();
    if (session.role === "admin") {
      return NextResponse.json({ records });
    }
    const trials = new Set(getCtvTrialGroupKeys());
    if (!trials.size) return NextResponse.json({ records: [] });
    const filtered = records.filter(
      (record) => trials.has(record.groupEmail.trim().toLowerCase()),
    );
    return NextResponse.json({ records: filtered });
  } catch (error) {
    return handleError(error);
  }
}

// POST /api/trials  body { groupKey, email, name?, trialCourse? }
//  → thêm thành viên vào Google Group + ghi record học thử lên Sheet (gắn email CTV).
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    groupKey?: string;
    email?: string;
    name?: string;
    trialCourse?: string;
    ctvEmail?: string;
    ctvName?: string;
  };
  if (isJsonBodyTooLarge(body, 16_000)) {
    return NextResponse.json({ error: "Payload quá lớn." }, { status: 413 });
  }
  const groupKey = body.groupKey?.trim() ?? "";
  const email = body.email ? normalizeEmail(body.email) : "";
  if (!groupKey || !isValidGroupKey(groupKey)) {
    return NextResponse.json({ error: "groupKey không hợp lệ." }, { status: 400 });
  }
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "Email học viên không hợp lệ." }, { status: 400 });
  }

  const session = await requireGroupAccess(groupKey);
  if (session instanceof NextResponse) return session;
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const rl = checkRateLimit(rateLimitKey(request, "trials:add", session.email), 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Thao tác quá nhanh, thử lại sau." }, { status: 429 });
  }

  // Mặc định gắn người đang đăng nhập. Riêng admin được phép gắn cho 1 CTV (domain) khác.
  // Validate ctvEmail để tránh ghi attribution bẩn vào Redis (stored-XSS/log-spoof sau này render).
  const rawCtvEmail = body.ctvEmail ? normalizeEmail(body.ctvEmail) : "";
  const requestedCtvEmail = rawCtvEmail && isValidEmail(rawCtvEmail) ? rawCtvEmail : "";
  const requestedCtvName = body.ctvName?.trim().slice(0, 120) ?? "";
  const attributedEmail =
    session.role === "admin" && (requestedCtvEmail || requestedCtvName)
      ? requestedCtvEmail
      : session.email;
  const attributedName =
    session.role === "admin" && requestedCtvName
      ? requestedCtvName
      : attributedEmail === session.email
        ? session.name
        : attributedEmail.split("@")[0];

  try {
    const directory = getDirectory();
    let member: ApiMember = {
      id: "",
      email,
      role: "MEMBER" as ApiGroupRole,
      status: "",
      type: "",
    };
    try {
      const res = await ensureGroupMember(directory, groupKey, email, "MEMBER");
      await ensureSheetHocDthtMember(directory, email, groupKey, { sourceAuthorized: true });
      member = {
        id: res.id ?? "",
        email: res.email ?? email,
        role: (res.role as ApiGroupRole) ?? "MEMBER",
        status: res.status ?? "",
        type: res.type ?? "",
      };
    } catch (insertError) {
      // ensureGroupMember absorbs 409, so any remaining error should stop the request.
      const code = (insertError as { code?: number }).code;
      if (code !== 409) throw insertError;
    }

    const record = await upsertTrialRecord({
      timestamp: new Date().toISOString(),
      groupEmail: groupKey.slice(0, 254),
      studentEmail: email,
      studentName: (body.name?.trim() ?? "").slice(0, 120),
      trialCourse: (body.trialCourse?.trim() ?? "").slice(0, 200),
      ctvEmail: attributedEmail.slice(0, 254),
      ctvName: attributedName.slice(0, 120),
    });

    await recordCtvActivity(session, {
      type: "add_member",
      groupEmail: groupKey,
      studentGmail: email,
      status: "done",
      detail: body.trialCourse?.trim()
        ? `Thêm học thử: ${body.trialCourse.trim()}`
        : "Thêm thành viên học thử",
    });

    return NextResponse.json({ member, record }, { status: 201 });
  } catch (error) {
    const { message } = describeApiError(error);
    await recordCtvActivity(session, {
      type: "add_member",
      groupEmail: groupKey,
      studentGmail: email,
      status: "failed",
      error: message,
      detail: body.trialCourse?.trim()
        ? `Thêm học thử: ${body.trialCourse.trim()}`
        : "Thêm thành viên học thử",
    });
    return handleError(error);
  }
}

// PATCH /api/trials  body { groupKey, email, status } → đổi trạng thái học thử.
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    groupKey?: string;
    email?: string;
    status?: string;
  };
  if (isJsonBodyTooLarge(body, 8_000)) {
    return NextResponse.json({ error: "Payload quá lớn." }, { status: 413 });
  }
  const groupKey = body.groupKey?.trim() ?? "";
  const email = body.email ? normalizeEmail(body.email) : "";
  const status = body.status?.trim() ?? "";
  if (!isValidGroupKey(groupKey) || !isValidEmail(email) || !status) {
    return NextResponse.json({ error: "groupKey, email hoặc status không hợp lệ." }, { status: 400 });
  }
  if (!VALID_STATUS.includes(status)) {
    return NextResponse.json({ error: "Trạng thái không hợp lệ." }, { status: 400 });
  }

  const session = await requireGroupAccess(groupKey);
  if (session instanceof NextResponse) return session;
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const rl = checkRateLimit(rateLimitKey(request, "trials:status", session.email), 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Thao tác quá nhanh, thử lại sau." }, { status: 429 });
  }

  try {
    const ok = await updateTrialStatus(groupKey, email, status);
    if (!ok) {
      await recordCtvActivity(session, {
        type: "update_trial_status",
        groupEmail: groupKey,
        studentGmail: email,
        status: "failed",
        error: "Không tìm thấy record học thử.",
        detail: `Chuyển trạng thái thành ${status}`,
      });
      return NextResponse.json({ error: "Không tìm thấy record học thử." }, { status: 404 });
    }
    await recordCtvActivity(session, {
      type: "update_trial_status",
      groupEmail: groupKey,
      studentGmail: email,
      status: "done",
      detail: `Chuyển trạng thái thành ${status}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const { message } = describeApiError(error);
    await recordCtvActivity(session, {
      type: "update_trial_status",
      groupEmail: groupKey,
      studentGmail: email,
      status: "failed",
      error: message,
      detail: `Chuyển trạng thái thành ${status}`,
    });
    return handleError(error);
  }
}
