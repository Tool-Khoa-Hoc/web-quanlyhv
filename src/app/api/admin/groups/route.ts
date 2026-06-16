import { NextResponse } from "next/server";

import {
  describeApiError,
  getCtvTrialGroupKey,
  getDirectory,
  getGroupByKey,
  getWorkspaceDomain,
} from "@/lib/google-admin";
import { requireSession } from "@/lib/api-guard";
import type { ApiGroup } from "@/lib/admin-types";

export const dynamic = "force-dynamic";

// GET /api/admin/groups
//  - Admin: tất cả nhóm trong domain.
//  - CTV: CHỈ nhóm học thử (CTV_TRIAL_GROUP_EMAIL). Chưa cấu hình → danh sách rỗng.
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    if (session.role === "ctv") {
      const trial = getCtvTrialGroupKey();
      if (!trial) return NextResponse.json({ groups: [] });
      try {
        const group = await getGroupByKey(trial);
        return NextResponse.json({ groups: [group] });
      } catch {
        // Nhóm học thử không tồn tại / không lấy được → trả rỗng thay vì lộ nhóm khác.
        return NextResponse.json({ groups: [] });
      }
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
