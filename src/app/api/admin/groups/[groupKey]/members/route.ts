import { NextResponse } from "next/server";

import { describeApiError, getDirectory } from "@/lib/google-admin";
import { requireGroupAccess } from "@/lib/api-guard";
import type { ApiGroupRole, ApiMember } from "@/lib/admin-types";

export const dynamic = "force-dynamic";

const VALID_ROLES: ApiGroupRole[] = ["OWNER", "MANAGER", "MEMBER"];

// GET /api/admin/groups/:groupKey/members → danh sách thành viên thật của nhóm.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ groupKey: string }> },
) {
  const { groupKey } = await params;
  const session = await requireGroupAccess(decodeURIComponent(groupKey));
  if (session instanceof NextResponse) return session;
  try {
    const directory = getDirectory();
    const members: ApiMember[] = [];
    let pageToken: string | undefined;
    do {
      const res = await directory.members.list({
        groupKey: decodeURIComponent(groupKey),
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
  const session = await requireGroupAccess(decodeURIComponent(groupKey));
  if (session instanceof NextResponse) return session;
  try {
    const body = (await request.json()) as { email?: string; role?: string };
    const email = body.email?.trim();
    if (!email) {
      return NextResponse.json({ error: "Thiếu email thành viên." }, { status: 400 });
    }
    const role = (body.role?.toUpperCase() as ApiGroupRole) || "MEMBER";
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: `Role không hợp lệ: ${role}` }, { status: 400 });
    }

    const directory = getDirectory();
    const res = await directory.members.insert({
      groupKey: decodeURIComponent(groupKey),
      requestBody: { email, role },
    });

    const member: ApiMember = {
      id: res.data.id ?? "",
      email: res.data.email ?? email,
      role: (res.data.role as ApiGroupRole) ?? role,
      status: res.data.status ?? "",
      type: res.data.type ?? "",
    };
    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    const { status, message } = describeApiError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
