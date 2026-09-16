import "server-only";

import { NextResponse } from "next/server";

import { ctvEmailAllowed, getOAuthConfig, getSession, type AppSession } from "./auth";
import {
  describeApiError,
  getCtvTrialGroupKeys,
  isCtvBlockedDirectGroup,
  isCtvTrialGroup,
} from "./google-admin";

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
  // Re-validate: admin bị thu quyền vẫn còn cookie cũ 12h -> phải chặn.
  // Fail-closed nếu thiếu cấu hình admin.
  try {
    const adminEmails = getOAuthConfig().adminEmails.map((e) => e.toLowerCase());
    if (!adminEmails.includes(session.email.trim().toLowerCase())) {
      return NextResponse.json({ error: "Quyền admin đã bị thu hồi." }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Cấu hình quyền chưa hoàn chỉnh." }, { status: 503 });
  }
  return session;
}

export function rejectCrossSiteMutation(request: Request): NextResponse | null {
  const url = new URL(request.url);
  const allowed = new Set([url.origin]);
  const appBaseUrl = process.env.APP_BASE_URL?.trim();
  if (appBaseUrl) allowed.add(appBaseUrl.replace(/\/+$/, ""));

  const origin = request.headers.get("origin")?.trim();
  if (origin) {
    if (allowed.has(origin.replace(/\/+$/, ""))) return null;
    return NextResponse.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  }

  // Không có Origin -> kiểm tra Referer (form POST, fetch same-origin thường có 1 trong 2).
  const referer = request.headers.get("referer")?.trim();
  if (referer) {
    try {
      if (allowed.has(new URL(referer).origin)) return null;
    } catch {
      // Referer méo -> chặn.
    }
    return NextResponse.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  }

  // Không Origin lẫn Referer: chỉ cho qua nếu client chứng minh là same-origin
  // qua Sec-Fetch-Site (Chrome/Safari/Edge gửi). Còn lại (curl, form cross-site cũ) -> chặn.
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "same-origin" || fetchSite === "same-site") return null;
  return NextResponse.json(
    { error: "Thiếu thông tin nguồn yêu cầu, thử tải lại trang." },
    { status: 403 },
  );
}

/**
 * Yêu cầu phiên đăng nhập + quyền trên nhóm groupKey.
 * - Admin: full quyền mọi nhóm.
 * - CTV: CHỈ được thao tác trên các nhóm học thử (CTV_TRIAL_GROUP_EMAILS).
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
  if (!getCtvTrialGroupKeys().length) {
    return NextResponse.json(
      { error: "Hệ thống chưa cấu hình nhóm học thử cho CTV (CTV_TRIAL_GROUP_EMAILS)." },
      { status: 403 },
    );
  }
  // Chặn tường minh thao tác trực tiếp vào group đặc quyền (sheet-hoc-dtht).
  // CTV chỉ được gián tiếp qua auto-add đã authorize ở server, không được GET/POST trực tiếp.
  if (isCtvBlockedDirectGroup(groupKey)) {
    return NextResponse.json(
      { error: "CTV không được thao tác trực tiếp nhóm này." },
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
