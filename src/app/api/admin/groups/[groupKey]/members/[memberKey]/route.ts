import { NextResponse } from "next/server";

import { describeApiError, getDirectory } from "@/lib/google-admin";
import { rejectCrossSiteMutation, requireAdmin } from "@/lib/api-guard";
import type { ApiGroupRole, ApiMember } from "@/lib/admin-types";

export const dynamic = "force-dynamic";

const VALID_ROLES: ApiGroupRole[] = ["OWNER", "MANAGER", "MEMBER"];

type MemberRouteParams = { groupKey?: string; memberKey?: string };
type MemberRouteBody = {
  groupKey?: string;
  memberKey?: string;
  memberEmail?: string;
  role?: string;
};

function decodeKey(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

async function readJsonBody(request: Request): Promise<MemberRouteBody> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return {};
  }

  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as MemberRouteBody) : {};
  } catch {
    return {};
  }
}

function resolveMemberKeys(
  request: Request,
  params: MemberRouteParams,
  body: MemberRouteBody = {},
) {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const membersIndex = segments.lastIndexOf("members");
  const pathGroupKey = membersIndex > 0 ? decodeKey(segments[membersIndex - 1]) : "";
  const pathMemberKey =
    membersIndex >= 0 && membersIndex < segments.length - 1
      ? decodeKey(segments[membersIndex + 1])
      : "";

  return {
    groupKey:
      decodeKey(params.groupKey) ||
      pathGroupKey ||
      decodeKey(url.searchParams.get("groupKey")) ||
      decodeKey(body.groupKey),
    memberKey:
      decodeKey(params.memberKey) ||
      pathMemberKey ||
      decodeKey(url.searchParams.get("memberKey")) ||
      decodeKey(body.memberKey) ||
      decodeKey(body.memberEmail),
  };
}

// DELETE /api/admin/groups/:groupKey/members/:memberKey → xóa thành viên khỏi nhóm.
// Chỉ ADMIN được xóa thành viên. CTV bị chặn (cả UI lẫn API).
export async function DELETE(
  request: Request,
  { params }: { params: Promise<MemberRouteParams> | MemberRouteParams },
) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const body = await readJsonBody(request);
  const { groupKey, memberKey } = resolveMemberKeys(request, await params, body);
  if (!groupKey) {
    return NextResponse.json({ error: "Thiếu Google Group." }, { status: 400 });
  }
  if (!memberKey) {
    return NextResponse.json({ error: "Thiếu email thành viên cần xóa." }, { status: 400 });
  }

  try {
    const directory = getDirectory();
    await directory.members.delete({
      groupKey,
      memberKey,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 404) {
      return NextResponse.json({ ok: true, missing: true });
    }
    const { status, message } = describeApiError(error);
    return NextResponse.json({ error: message }, { status });
  }
}

// PATCH /api/admin/groups/:groupKey/members/:memberKey  body: { role } → đổi vai trò.
// Chỉ ADMIN được cấp/đổi role (OWNER/MANAGER/MEMBER) trên mọi nhóm. CTV không được.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<MemberRouteParams> | MemberRouteParams },
) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const body = await readJsonBody(request);
  const { groupKey, memberKey } = resolveMemberKeys(request, await params, body);
  if (!groupKey) {
    return NextResponse.json({ error: "Thiếu Google Group." }, { status: 400 });
  }
  if (!memberKey) {
    return NextResponse.json({ error: "Thiếu email thành viên cần đổi vai trò." }, { status: 400 });
  }

  try {
    const role = body.role?.toUpperCase() as ApiGroupRole | undefined;
    if (!role || !VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: `Role không hợp lệ: ${body.role}` }, { status: 400 });
    }

    const directory = getDirectory();
    const res = await directory.members.patch({
      groupKey,
      memberKey,
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
