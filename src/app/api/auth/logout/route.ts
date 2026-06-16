import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/auth/logout → xóa session cookie và quay về trang chủ.
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const res = NextResponse.redirect(new URL("/", origin));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
