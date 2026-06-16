import "server-only";

import { NextResponse } from "next/server";

import { getSession, type AppSession } from "./auth";
import { userIsGroupMember } from "./google-admin";

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
 * Admin: full quyền mọi nhóm. CTV: phải là thành viên của nhóm.
 */
export async function requireGroupAccess(groupKey: string): Promise<AppSession | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }
  if (session.role === "admin") return session;

  const allowed = await userIsGroupMember(session.email, groupKey);
  if (!allowed) {
    return NextResponse.json(
      { error: "Bạn không có quyền với nhóm này." },
      { status: 403 },
    );
  }
  return session;
}
