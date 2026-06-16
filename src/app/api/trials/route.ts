import { NextResponse } from "next/server";

import { describeApiError, getDirectory, getCtvTrialGroupKey } from "@/lib/google-admin";
import { requireGroupAccess, requireSession } from "@/lib/api-guard";
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
    const trial = getCtvTrialGroupKey();
    if (!trial) return NextResponse.json({ records: [] });
    const filtered = records.filter(
      (record) => record.groupEmail.trim().toLowerCase() === trial,
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
  };
  const groupKey = body.groupKey?.trim();
  const email = body.email?.trim().toLowerCase();
  if (!groupKey || !email) {
    return NextResponse.json({ error: "Thiếu groupKey hoặc email." }, { status: 400 });
  }

  const session = await requireGroupAccess(groupKey);
  if (session instanceof NextResponse) return session;

  // Mặc định gắn người đang đăng nhập. Riêng admin được phép gắn cho 1 CTV (domain) khác.
  const attributedEmail =
    session.role === "admin" && body.ctvEmail?.trim()
      ? body.ctvEmail.trim().toLowerCase()
      : session.email;
  const attributedName =
    attributedEmail === session.email ? session.name : attributedEmail.split("@")[0];

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
      const res = await directory.members.insert({
        groupKey,
        requestBody: { email, role: "MEMBER" },
      });
      member = {
        id: res.data.id ?? "",
        email: res.data.email ?? email,
        role: (res.data.role as ApiGroupRole) ?? "MEMBER",
        status: res.data.status ?? "",
        type: res.data.type ?? "",
      };
    } catch (insertError) {
      // 409 = đã là thành viên: bỏ qua, vẫn ghi record học thử.
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

    return NextResponse.json({ member, record }, { status: 201 });
  } catch (error) {
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

  try {
    const ok = await updateTrialStatus(groupKey, email, status);
    if (!ok) {
      return NextResponse.json({ error: "Không tìm thấy record học thử." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
