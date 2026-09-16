import { NextResponse } from "next/server";

import { rejectCrossSiteMutation, requireAdmin } from "@/lib/api-guard";
import type { ApiLockedGroup, ApiLockStudentResult } from "@/lib/admin-types";
import { describeApiError, getDirectory } from "@/lib/google-admin";
import { getErrorMessage } from "@/lib/error-message";
import { checkRateLimit, isValidEmail, normalizeEmail, rateLimitKey } from "@/lib/validation";

export const dynamic = "force-dynamic";

// POST /api/admin/students/:studentEmail/lock
// Thu hồi membership trực tiếp của học viên khỏi mọi Google Group mà họ đang là thành viên.
// Không suspend tài khoản Workspace.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ studentEmail: string }> },
) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  // Thao tác phá hoại hàng loạt -> rate-limit chặt.
  const rl = checkRateLimit(rateLimitKey(request, "students:lock", session.email), 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Thao tác quá nhanh, thử lại sau." }, { status: 429 });
  }

  const { studentEmail: encodedStudentEmail } = await params;
  let studentEmail = "";
  try {
    studentEmail = normalizeEmail(decodeURIComponent(encodedStudentEmail));
  } catch {
    studentEmail = normalizeEmail(encodedStudentEmail);
  }
  if (!isValidEmail(studentEmail)) {
    return NextResponse.json({ error: "Email học viên không hợp lệ." }, { status: 400 });
  }

  try {
    const directory = getDirectory();
    const matchedGroups: ApiLockedGroup[] = [];
    let pageToken: string | undefined;

    // Liệt kê trực tiếp các group mà học viên đang là thành viên (mọi tên/tiền tố),
    // thay vì đoán theo tiền tố email group.
    do {
      const res = await directory.groups.list({
        userKey: studentEmail,
        maxResults: 200,
        pageToken,
      });
      for (const group of res.data.groups ?? []) {
        const email = (group.email ?? "").trim().toLowerCase();
        if (!email) continue;
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
