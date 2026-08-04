import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api-guard";
import { listCtvActivities } from "@/lib/activity-store";
import { KvStoreError } from "@/lib/kv";

export const dynamic = "force-dynamic";

// GET /api/jobs → nhật ký thao tác CTV, chỉ admin được xem.
export async function GET() {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  try {
    return NextResponse.json({ jobs: await listCtvActivities() });
  } catch (error) {
    if (error instanceof KvStoreError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: "Không đọc được nhật ký CTV." }, { status: 500 });
  }
}
