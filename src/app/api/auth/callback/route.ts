import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  createOAuthClient,
  ctvEmailAllowed,
  getOAuthConfig,
  isSecureCookie,
  roleForEmail,
  signSession,
} from "@/lib/auth";
import { getErrorMessage } from "@/lib/error-message";

export const dynamic = "force-dynamic";

function errorRedirect(origin: string, message: string) {
  const url = new URL("/", origin);
  url.searchParams.set("authError", message);
  return NextResponse.redirect(url);
}

// GET /api/auth/callback → nhận code từ Google, xác thực id_token, tạo session cookie.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const stateCookie = (await cookies()).get(OAUTH_STATE_COOKIE)?.value?.trim();

  if (!code) return errorRedirect(origin, "Thiếu mã xác thực từ Google.");
  if (!state || !stateCookie || state.length > 128 || stateCookie.length > 128) {
    return errorRedirect(origin, "State không hợp lệ, thử đăng nhập lại.");
  }
  // So sánh constant-time để chống timing oracle.
  const a = Buffer.from(state);
  const b = Buffer.from(stateCookie);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return errorRedirect(origin, "State không hợp lệ, thử đăng nhập lại.");
  }

  try {
    const config = getOAuthConfig();
    const client = createOAuthClient(origin);
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) return errorRedirect(origin, "Google không trả id_token.");

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.clientId,
    });
    const payload = ticket.getPayload();
    const email = payload?.email?.toLowerCase();

    if (!email || !payload?.email_verified) {
      return errorRedirect(origin, "Email chưa được xác minh.");
    }
    // Bắt buộc tài khoản thuộc domain nội bộ.
    const domainOk = payload.hd === config.domain || email.endsWith(`@${config.domain}`);
    if (!domainOk) {
      return errorRedirect(
        origin,
        `Chỉ chấp nhận tài khoản @${config.domain}. Bạn đã đăng nhập bằng ${email}.`,
      );
    }

    const role = roleForEmail(email, config);
    if (role === "ctv" && !(await ctvEmailAllowed(email))) {
      return errorRedirect(origin, "Tài khoản này chưa được cấp quyền CTV.");
    }
    const { token, maxAge } = signSession(
      { email, name: payload.name ?? email, role },
      config.sessionSecret,
    );

    const res = NextResponse.redirect(new URL("/", origin));
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureCookie(origin),
      path: "/",
      maxAge,
    });
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  } catch (error) {
    const message = getErrorMessage(error, "Đăng nhập thất bại.");
    return errorRedirect(origin, message);
  }
}
