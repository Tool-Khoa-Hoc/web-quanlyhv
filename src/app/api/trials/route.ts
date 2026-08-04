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
  const groupKey = body.groupKey?.trim();
  const email = body.email?.trim().toLowerCase();
  if (!groupKey || !email) {
    return NextResponse.json({ error: "Thiếu groupKey hoặc email." }, { status: 400 });
  }

  const session = await requireGroupAccess(groupKey);
  if (session instanceof NextResponse) return session;
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  // Mặc định gắn người đang đăng nhập. Riêng admin được phép gắn cho 1 CTV (domain) khác.
  const requestedCtvEmail = body.ctvEmail?.trim().toLowerCase() ?? "";
  const requestedCtvName = body.ctvName?.trim() ?? "";
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
      await ensureSheetHocDthtMember(directory, email, groupKey);
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
      groupEmail: groupKey,
      studentEmail: email,
      studentName: body.name?.trim() ?? "",
      trialCourse: body.trialCourse?.trim() ?? "",
      ctvEmail: attributedEmail,
      ctvName: attributedName,
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
  const groupKey = body.groupKey?.trim();
  const email = body.email?.trim().toLowerCase();
  const status = body.status?.trim();
  if (!groupKey || !email || !status) {
    return NextResponse.json({ error: "Thiếu groupKey, email hoặc status." }, { status: 400 });
  }
  if (!VALID_STATUS.includes(status)) {
    return NextResponse.json({ error: `Trạng thái không hợp lệ: ${status}` }, { status: 400 });
  }

  const session = await requireGroupAccess(groupKey);
  if (session instanceof NextResponse) return session;
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

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
