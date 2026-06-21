import "server-only";

import { NextResponse } from "next/server";

import { ctvEmailAllowed, getSession, type AppSession } from "./auth";
import { describeApiError, getCtvTrialGroupKey, isCtvTrialGroup } from "./google-admin";

// Helper bảo vệ các API route: trả về session hợp lệ hoặc NextResponse lỗi.
// Cách dùng: const s = await requireSession(); if (s instanceof NextResponse) return s;

export async function requireSession(): Promise<AppSession | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }
  if (session.role === "ctv") {
    try {
      if (!(await ctvEmailAllowed(session.email))) {
        return NextResponse.json({ error: "Tài khoản CTV chưa được cấp quyền." }, { status: 403 });
      }
    } catch (error) {
      const { status, message } = describeApiError(error);
      return NextResponse.json({ error: message }, { status });
    }
  }
  return session;
}

export async function requireAdmin(): Promise<AppSession | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Chỉ admin được phép." }, { status: 403 });
  }
  return session;
}

export function rejectCrossSiteMutation(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  const allowed = new Set([new URL(request.url).origin]);
  const appBaseUrl = process.env.APP_BASE_URL?.trim();
  if (appBaseUrl) allowed.add(appBaseUrl.replace(/\/+$/, ""));

  if (allowed.has(origin)) return null;
  return NextResponse.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
}

/**
 * Yêu cầu phiên đăng nhập + quyền trên nhóm groupKey.
 * - Admin: full quyền mọi nhóm.
 * - CTV: CHỈ được thao tác trên nhóm học thử (CTV_TRIAL_GROUP_EMAIL).
 *   Fail-closed: nếu chưa cấu hình nhóm học thử thì CTV bị chặn hoàn toàn.
 */
export async function requireGroupAccess(groupKey: string): Promise<AppSession | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }
  if (session.role === "admin") return session;

  // CTV
  try {
    if (!(await ctvEmailAllowed(session.email))) {
      return NextResponse.json({ error: "Tài khoản CTV chưa được cấp quyền." }, { status: 403 });
    }
  } catch (error) {
    const { status, message } = describeApiError(error);
    return NextResponse.json({ error: message }, { status });
  }
  if (!getCtvTrialGroupKey()) {
    return NextResponse.json(
      { error: "Hệ thống chưa cấu hình nhóm học thử cho CTV (CTV_TRIAL_GROUP_EMAIL)." },
      { status: 403 },
    );
  }
  if (!isCtvTrialGroup(groupKey)) {
    return NextResponse.json(
      { error: "CTV chỉ được thao tác trên nhóm học thử." },
      { status: 403 },
    );
  }
  return session;
}
