import { NextResponse } from "next/server";

import { describeApiError } from "@/lib/google-admin";
import {
  OAUTH_STATE_COOKIE,
  createOAuthClient,
  getOAuthConfig,
  newStateToken,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/auth/login → chuyển hướng tới màn đăng nhập Google (giới hạn domain nội bộ).
export async function GET(request: Request) {
  try {
    const origin = new URL(request.url).origin;
    const config = getOAuthConfig();
    const client = createOAuthClient(origin);
    const state = newStateToken();

    const url = client.generateAuthUrl({
      access_type: "online",
      prompt: "select_account",
      scope: ["openid", "email", "profile"],
      hd: config.domain, // gợi ý chỉ chấp nhận tài khoản trong domain nội bộ
      state,
    });

    const res = NextResponse.redirect(url);
    res.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https://"),
      path: "/",
      maxAge: 600,
    });
    return res;
  } catch (error) {
    const { status, message } = describeApiError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
