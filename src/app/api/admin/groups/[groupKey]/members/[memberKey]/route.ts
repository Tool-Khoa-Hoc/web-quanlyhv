import { NextResponse } from "next/server";

import { describeApiError, getDirectory } from "@/lib/google-admin";
import { requireAdmin } from "@/lib/api-guard";
import type { ApiGroupRole, ApiMember } from "@/lib/admin-types";

export const dynamic = "force-dynamic";

const VALID_ROLES: ApiGroupRole[] = ["OWNER", "MANAGER", "MEMBER"];

// DELETE /api/admin/groups/:groupKey/members/:memberKey → xóa thành viên khỏi nhóm.
// Chỉ ADMIN được xóa thành viên. CTV bị chặn (cả UI lẫn API).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ groupKey: string; memberKey: string }> },
) {
  const { groupKey, memberKey } = await params;
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  try {
    const directory = getDirectory();
    await directory.members.delete({
      groupKey: decodeURIComponent(groupKey),
      memberKey: decodeURIComponent(memberKey),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const { status, message } = describeApiError(error);
    return NextResponse.json({ error: message }, { status });
  }
}

// PATCH /api/admin/groups/:groupKey/members/:memberKey  body: { role } → đổi vai trò.
// Chỉ ADMIN được cấp/đổi role (OWNER/MANAGER/MEMBER) trên mọi nhóm. CTV không được.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ groupKey: string; memberKey: string }> },
) {
  const { groupKey, memberKey } = await params;
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  try {
    const body = (await request.json()) as { role?: string };
    const role = body.role?.toUpperCase() as ApiGroupRole | undefined;
    if (!role || !VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: `Role không hợp lệ: ${body.role}` }, { status: 400 });
    }

    const directory = getDirectory();
    const res = await directory.members.patch({
      groupKey: decodeURIComponent(groupKey),
      memberKey: decodeURIComponent(memberKey),
      requestBody: { role },
    });

    const member: ApiMember = {
      id: res.data.id ?? "",
      email: res.data.email ?? "",
      role: (res.data.role as ApiGroupRole) ?? role,
      status: res.data.status ?? "",
      type: res.data.type ?? "",
    };
    return NextResponse.json({ member });
  } catch (error) {
    const { status, message } = describeApiError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
