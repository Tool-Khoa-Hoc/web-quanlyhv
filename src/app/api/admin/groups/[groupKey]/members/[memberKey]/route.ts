import { NextResponse } from "next/server";

import { describeApiError, getDirectory } from "@/lib/google-admin";
import { rejectCrossSiteMutation, requireAdmin } from "@/lib/api-guard";
import {
  checkRateLimit,
  isJsonBodyTooLarge,
  isValidEmail,
  isValidGroupKey,
  normalizeEmail,
  rateLimitKey,
} from "@/lib/validation";
import type { ApiGroupRole, ApiMember } from "@/lib/admin-types";

export const dynamic = "force-dynamic";

const VALID_ROLES: ApiGroupRole[] = ["OWNER", "MANAGER", "MEMBER"];

type MemberRouteParams = { groupKey?: string; memberKey?: string };

function decodeKey(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

// CHỈ tin path params. Không đọc groupKey/memberKey từ query string hay JSON body
// để tránh log-spoof / thao tác nhầm group khác với URL hiển thị.
function resolvePathKeys(params: MemberRouteParams) {
  return {
    groupKey: decodeKey(params.groupKey),
    memberKey: decodeKey(params.memberKey),
  };
}

async function readRoleBody(request: Request): Promise<{ role?: unknown }> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return {};
  }
  try {
    const body = await request.json();
    if (isJsonBodyTooLarge(body, 4_000)) return {};
    return body && typeof body === "object" ? (body as { role?: unknown }) : {};
  } catch {
    return {};
  }
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
  const rl = checkRateLimit(rateLimitKey(request, "members:delete", session.email), 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Thao tác quá nhanh, thử lại sau." }, { status: 429 });
  }

  const { groupKey, memberKey } = resolvePathKeys(await params);
  if (!isValidGroupKey(groupKey)) {
    return NextResponse.json({ error: "Google Group không hợp lệ." }, { status: 400 });
  }
  const memberEmail = memberKey ? normalizeEmail(memberKey) : "";
  if (!memberEmail || !isValidEmail(memberEmail)) {
    return NextResponse.json({ error: "Email thành viên không hợp lệ." }, { status: 400 });
  }

  try {
    const directory = getDirectory();
    await directory.members.delete({
      groupKey,
      memberKey: memberEmail,
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
  const rl = checkRateLimit(rateLimitKey(request, "members:role", session.email), 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Thao tác quá nhanh, thử lại sau." }, { status: 429 });
  }

  const { groupKey, memberKey } = resolvePathKeys(await params);
  if (!isValidGroupKey(groupKey)) {
    return NextResponse.json({ error: "Google Group không hợp lệ." }, { status: 400 });
  }
  const memberEmail = memberKey ? normalizeEmail(memberKey) : "";
  if (!memberEmail || !isValidEmail(memberEmail)) {
    return NextResponse.json({ error: "Email thành viên không hợp lệ." }, { status: 400 });
  }

  try {
    const body = await readRoleBody(request);
    const role =
      typeof body.role === "string" ? (body.role.toUpperCase() as ApiGroupRole) : undefined;
    if (!role || !VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Role không hợp lệ." }, { status: 400 });
    }

    const directory = getDirectory();
    const res = await directory.members.patch({
      groupKey,
      memberKey: memberEmail,
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
