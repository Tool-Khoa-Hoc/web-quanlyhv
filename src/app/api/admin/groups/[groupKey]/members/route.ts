import { NextResponse } from "next/server";

import {
  describeApiError,
  ensureGroupMember,
  ensureSheetHocDthtMember,
  getDirectory,
} from "@/lib/google-admin";
import { rejectCrossSiteMutation, requireGroupAccess } from "@/lib/api-guard";
import { recordCtvActivity } from "@/lib/activity-store";
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

// GET /api/admin/groups/:groupKey/members → danh sách thành viên thật của nhóm.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ groupKey: string }> },
) {
  const { groupKey } = await params;
  const rawGroupKey = decodeURIComponent(groupKey).trim();
  if (!isValidGroupKey(rawGroupKey)) {
    return NextResponse.json({ error: "Google Group không hợp lệ." }, { status: 400 });
  }
  const session = await requireGroupAccess(rawGroupKey);
  if (session instanceof NextResponse) return session;
  const rl = checkRateLimit(rateLimitKey(request, "members:list", session.email), 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Thao tác quá nhanh, thử lại sau." }, { status: 429 });
  }
  try {
    const directory = getDirectory();
    const members: ApiMember[] = [];
    let pageToken: string | undefined;
    do {
      const res = await directory.members.list({
        groupKey: rawGroupKey,
        maxResults: 200,
        pageToken,
      });
      for (const m of res.data.members ?? []) {
        members.push({
          id: m.id ?? "",
          email: m.email ?? "",
          role: (m.role as ApiGroupRole) ?? "MEMBER",
          status: m.status ?? "",
          type: m.type ?? "",
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return NextResponse.json({ members });
  } catch (error) {
    const { status, message } = describeApiError(error);
    return NextResponse.json({ error: message }, { status });
  }
}

// POST /api/admin/groups/:groupKey/members  body: { email, role? } → thêm thành viên.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ groupKey: string }> },
) {
  const { groupKey } = await params;
  const decodedGroupKey = decodeURIComponent(groupKey).trim();
  if (!isValidGroupKey(decodedGroupKey)) {
    return NextResponse.json({ error: "Google Group không hợp lệ." }, { status: 400 });
  }
  const session = await requireGroupAccess(decodedGroupKey);
  if (session instanceof NextResponse) return session;
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const rl = checkRateLimit(rateLimitKey(request, "members:add", session.email), 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Thao tác quá nhanh, thử lại sau." }, { status: 429 });
  }
  const body = (await request.json().catch(() => ({}))) as { email?: string; role?: string };
  if (isJsonBodyTooLarge(body, 8_000)) {
    return NextResponse.json({ error: "Payload quá lớn." }, { status: 413 });
  }
  const email = body.email ? normalizeEmail(body.email) : "";
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "Email thành viên không hợp lệ." }, { status: 400 });
  }

  try {
    let role = (body.role?.toUpperCase() as ApiGroupRole) || "MEMBER";
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: `Role không hợp lệ: ${role}` }, { status: 400 });
    }
    // CTV không được cấp role cao: mọi thành viên CTV thêm vào đều là MEMBER.
    if (session.role === "ctv") {
      role = "MEMBER";
    }

    const directory = getDirectory();
    const addedMember = await ensureGroupMember(directory, decodedGroupKey, email, role);
    // Auto-add vào group sheet-hoc là side-effect đặc quyền: chỉ chạy khi source-group
    // đã authorize ở trên, luôn ép MEMBER, có ghi log để truy vết CTV nào trigger.
    await ensureSheetHocDthtMember(directory, email, decodedGroupKey, {
      sourceAuthorized: true,
    });

    const member: ApiMember = {
      id: addedMember.id ?? "",
      email: addedMember.email ?? email,
      role: (addedMember.role as ApiGroupRole) ?? role,
      status: addedMember.status ?? "",
      type: addedMember.type ?? "",
    };
    await recordCtvActivity(session, {
      type: "add_member",
      groupEmail: decodedGroupKey,
      studentGmail: email,
      status: "done",
      detail:
        session.role === "ctv"
          ? "CTV thêm MEMBER (kèm auto-add sheet-hoc đã authorize)"
          : `Thêm thành viên với vai trò ${role}`,
    });
    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    const { status, message } = describeApiError(error);
    await recordCtvActivity(session, {
      type: "add_member",
      groupEmail: decodedGroupKey,
      studentGmail: email,
      status: "failed",
      error: message,
    });
    return NextResponse.json({ error: message }, { status });
  }
}
