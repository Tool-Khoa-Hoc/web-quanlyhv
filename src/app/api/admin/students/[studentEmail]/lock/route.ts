import { NextResponse } from "next/server";

import { rejectCrossSiteMutation, requireAdmin } from "@/lib/api-guard";
import type { ApiLockedGroup, ApiLockStudentResult } from "@/lib/admin-types";
import { describeApiError, getDirectory, getWorkspaceDomain } from "@/lib/google-admin";
import { getErrorMessage } from "@/lib/error-message";

export const dynamic = "force-dynamic";

function isStudentAccessGroup(email: string): boolean {
  const localPart = email.trim().toLowerCase().split("@", 1)[0] ?? "";
  return localPart.startsWith("sv-");
}

// POST /api/admin/students/:studentEmail/lock
// Thu hồi membership trực tiếp khỏi mọi group dành cho sinh viên (primary email bắt đầu `sv-`).
// Không suspend tài khoản Workspace và không tác động các group khác như nhóm CTV/học thử.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ studentEmail: string }> },
) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const { studentEmail: encodedStudentEmail } = await params;
  const studentEmail = decodeURIComponent(encodedStudentEmail).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studentEmail)) {
    return NextResponse.json({ error: "Email học viên không hợp lệ." }, { status: 400 });
  }

  try {
    const directory = getDirectory();
    const domain = getWorkspaceDomain();
    const matchedGroups: ApiLockedGroup[] = [];
    let pageToken: string | undefined;

    do {
      const res = await directory.groups.list({
        domain,
        maxResults: 200,
        pageToken,
      });
      for (const group of res.data.groups ?? []) {
        const email = (group.email ?? "").trim().toLowerCase();
        if (!email || !isStudentAccessGroup(email)) continue;
        matchedGroups.push({ email, name: group.name ?? email });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    const removedGroups: ApiLockedGroup[] = [];
    const skippedGroups: ApiLockedGroup[] = [];
    const failedGroups: ApiLockStudentResult["failedGroups"] = [];

    for (const group of matchedGroups) {
      try {
        await directory.members.delete({
          groupKey: group.email,
          memberKey: studentEmail,
        });
        removedGroups.push(group);
      } catch (error) {
        const code = (error as { code?: number }).code;
        // 404: sinh viên không có membership trực tiếp trong group này.
        if (code === 404) {
          skippedGroups.push(group);
          continue;
        }
        failedGroups.push({ ...group, error: getErrorMessage(error) });
      }
    }

    const result: ApiLockStudentResult = {
      studentEmail,
      matchedGroups,
      removedGroups,
      skippedGroups,
      failedGroups,
    };
    return NextResponse.json(result, { status: failedGroups.length ? 207 : 200 });
  } catch (error) {
    const { status, message } = describeApiError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
