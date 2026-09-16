import { NextResponse } from "next/server";

import { describeApiError, getAdminRuntimeConfig, getDirectory } from "@/lib/google-admin";
import { requireAdmin } from "@/lib/api-guard";
import { checkRateLimit, rateLimitKey } from "@/lib/validation";
import type { ApiAdminStatus } from "@/lib/admin-types";

export const dynamic = "force-dynamic";

// GET /api/admin/status -> kiểm tra cấu hình Service Account + Domain-wide Delegation (chỉ admin).
export async function GET(request: Request) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  const rl = checkRateLimit(rateLimitKey(request, "admin:status", session.email), 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Thao tác quá nhanh, thử lại sau." }, { status: 429 });
  }

  try {
    const config = getAdminRuntimeConfig();
    const directory = getDirectory();
    const res = await directory.groups.list({
      domain: config.domain,
      maxResults: 1,
    });

    const status: ApiAdminStatus = {
      ok: true,
      domain: config.domain,
      impersonateEmail: config.impersonateEmail,
      serviceAccountEmail: config.serviceAccountEmail,
      credentialSource: config.credentialSource,
      sampleGroups: res.data.groups?.length ?? 0,
      checkedAt: new Date().toISOString(),
    };

    return NextResponse.json(status);
  } catch (error) {
    const { status, message } = describeApiError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
