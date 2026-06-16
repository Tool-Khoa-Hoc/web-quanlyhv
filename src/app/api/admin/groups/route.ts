import { NextResponse } from "next/server";

import { describeApiError, getDirectory, getWorkspaceDomain, listGroupsForUser } from "@/lib/google-admin";
import { requireSession } from "@/lib/api-guard";
import type { ApiGroup } from "@/lib/admin-types";

export const dynamic = "force-dynamic";

// GET /api/admin/groups
//  - Admin: tất cả nhóm trong domain.
//  - CTV: chỉ các nhóm mà họ là thành viên (được cấp quyền).
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    if (session.role === "ctv") {
      const groups = await listGroupsForUser(session.email);
      groups.sort((a, b) => a.name.localeCompare(b.name, "vi"));
      return NextResponse.json({ groups });
    }

    const directory = getDirectory();
    const domain = getWorkspaceDomain();

    const groups: ApiGroup[] = [];
    let pageToken: string | undefined;
    do {
      const res = await directory.groups.list({
        domain,
        maxResults: 200,
        pageToken,
      });
      for (const g of res.data.groups ?? []) {
        groups.push({
          id: g.id ?? "",
          email: g.email ?? "",
          name: g.name ?? g.email ?? "",
          description: g.description ?? "",
          directMembersCount: Number(g.directMembersCount ?? 0),
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    groups.sort((a, b) => a.name.localeCompare(b.name, "vi"));
    return NextResponse.json({ groups });
  } catch (error) {
    const { status, message } = describeApiError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
