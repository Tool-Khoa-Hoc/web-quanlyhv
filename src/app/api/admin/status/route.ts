import { NextResponse } from "next/server";

import { describeApiError, getAdminRuntimeConfig, getDirectory } from "@/lib/google-admin";
import { requireAdmin } from "@/lib/api-guard";
import type { ApiAdminStatus } from "@/lib/admin-types";

export const dynamic = "force-dynamic";

// GET /api/admin/status -> kiểm tra cấu hình Service Account + Domain-wide Delegation (chỉ admin).
export async function GET() {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

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
