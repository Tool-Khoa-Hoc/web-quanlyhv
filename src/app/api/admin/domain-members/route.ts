import { NextResponse } from "next/server";

import {
  describeApiError,
  getCtvTrialGroupKey,
  getDirectory,
  getWorkspaceDomain,
} from "@/lib/google-admin";
import { requireSession } from "@/lib/api-guard";
import type { DomainMember } from "@/lib/admin-types";

export const dynamic = "force-dynamic";

// GET /api/admin/domain-members
//  → email các thành viên NỘI BỘ (thuộc domain Workspace) đang ở trong nhóm học thử.
//    Dùng để chọn CTV khi thêm đăng ký — thay danh sách CTV cục bộ bằng tài khoản domain thật.
//    Lọc bỏ học viên ngoài (gmail...) chỉ giữ email kết thúc bằng @<domain>.
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const trialGroupKey = getCtvTrialGroupKey();
  if (!trialGroupKey) return NextResponse.json({ members: [] });

  try {
    const domainSuffix = `@${getWorkspaceDomain().trim().toLowerCase()}`;
    const directory = getDirectory();
    const emails = new Set<string>();
    let pageToken: string | undefined;
    do {
      const res = await directory.members.list({
        groupKey: trialGroupKey,
        maxResults: 200,
        pageToken,
      });
      for (const m of res.data.members ?? []) {
        const email = (m.email ?? "").trim().toLowerCase();
        if (email.endsWith(domainSuffix)) emails.add(email);
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    const members: DomainMember[] = Array.from(emails)
      .sort()
      .map((email) => ({ email }));
    return NextResponse.json({ members });
  } catch (error) {
    const { status, message } = describeApiError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
