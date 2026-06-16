import "server-only";

import { NextResponse } from "next/server";

import { getSession, type AppSession } from "./auth";
import { getCtvTrialGroupKey, isCtvTrialGroup } from "./google-admin";

// Helper bảo vệ các API route: trả về session hợp lệ hoặc NextResponse lỗi.
// Cách dùng: const s = await requireSession(); if (s instanceof NextResponse) return s;

export async function requireSession(): Promise<AppSession | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
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
