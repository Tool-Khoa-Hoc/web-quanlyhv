import { NextResponse } from "next/server";

import {
  describeApiError,
  getCtvTrialGroupKeys,
  getDirectory,
  getGroupByKey,
  getWorkspaceDomain,
  isCtvTrialGroup,
} from "@/lib/google-admin";
import { rejectCrossSiteMutation, requireAdmin, requireSession } from "@/lib/api-guard";
import {
  checkRateLimit,
  isJsonBodyTooLarge,
  isValidEmail,
  normalizeEmail,
  rateLimitKey,
} from "@/lib/validation";
import type { ApiGroup } from "@/lib/admin-types";

export const dynamic = "force-dynamic";

// GET /api/admin/groups
//  - Admin: tất cả nhóm trong domain.
//  - CTV: CHỈ các nhóm học thử (CTV_TRIAL_GROUP_EMAILS). Chưa cấu hình → danh sách rỗng.
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    if (session.role === "ctv") {
      const trialGroups = getCtvTrialGroupKeys();
      if (!trialGroups.length) return NextResponse.json({ groups: [] });
      try {
        const groups: ApiGroup[] = [];
        for (const trial of trialGroups) {
          try {
            groups.push(await getGroupByKey(trial));
          } catch {
            // Ignore missing/inaccessible configured trial groups.
          }
        }
        return NextResponse.json({ groups });
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
          isTrial: isCtvTrialGroup(g.email ?? ""),
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

// POST /api/admin/groups  body: { email, name?, description? } → tạo Google Group thật.
// Chỉ admin được tạo nhóm (CTV bị chặn).
export async function POST(request: Request) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const rl = checkRateLimit(rateLimitKey(request, "groups:create", session.email), 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Thao tác quá nhanh, thử lại sau." }, { status: 429 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      name?: string;
      description?: string;
    };
    if (isJsonBodyTooLarge(body, 8_000)) {
      return NextResponse.json({ error: "Payload quá lớn." }, { status: 413 });
    }
    const email = body.email ? normalizeEmail(body.email) : "";
    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: "Email nhóm không hợp lệ." }, { status: 400 });
    }
    const name = (body.name?.trim() || email).slice(0, 120);
    const description = body.description?.trim().slice(0, 500) || undefined;

    const directory = getDirectory();
    const res = await directory.groups.insert({
      requestBody: {
        email,
        name,
        description,
      },
    });

    const g = res.data;
    const group: ApiGroup = {
      id: g.id ?? "",
      email: g.email ?? email,
      name: g.name ?? name,
      description: g.description ?? "",
      directMembersCount: Number(g.directMembersCount ?? 0),
      isTrial: isCtvTrialGroup(g.email ?? email),
    };
    return NextResponse.json({ group }, { status: 201 });
  } catch (error) {
    const { status, message } = describeApiError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
