import { NextResponse } from "next/server";

import { rejectCrossSiteMutation, requireAdmin } from "@/lib/api-guard";
import { describeApiError } from "@/lib/google-admin";
import { KvStoreError } from "@/lib/kv";
import {
  isLedgerConfigured,
  readLedger,
  writeLedger,
  type LedgerPayload,
} from "@/lib/ledger-store";

export const dynamic = "force-dynamic";

function handleError(error: unknown) {
  if (error instanceof KvStoreError) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
  const { status, message } = describeApiError(error);
  return NextResponse.json({ error: message }, { status });
}

// GET /api/ledger → sổ cái nghiệp vụ dùng chung (CTV, học viên, giao dịch, thông số).
// Chỉ admin. Chưa cấu hình KV → trả ledger=null (client dùng localStorage như cũ).
export async function GET() {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  if (!isLedgerConfigured()) return NextResponse.json({ ledger: null });
  try {
    const ledger = await readLedger();
    return NextResponse.json({ ledger });
  } catch (error) {
    return handleError(error);
  }
}

// PUT /api/ledger  body { payload, baseRev } → ghi sổ cái (kiểm tra đụng độ theo rev).
//  - Ghi được → { ok: true, ledger }.
//  - Đụng độ (baseRev cũ) → 409 { ok: false, ledger } (bản server mới nhất để client hợp nhất).
export async function PUT(request: Request) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  if (!isLedgerConfigured()) {
    return NextResponse.json({ error: "Chưa cấu hình kho dữ liệu." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    payload?: LedgerPayload;
    baseRev?: number;
  };
  const payload = body.payload;
  if (
    !payload ||
    !Array.isArray(payload.ctvs) ||
    !Array.isArray(payload.students) ||
    !Array.isArray(payload.enrollments) ||
    !Array.isArray(payload.jobs) ||
    !payload.settings
  ) {
    return NextResponse.json({ error: "Payload sổ cái không hợp lệ." }, { status: 400 });
  }
  const baseRev = Number.isFinite(body.baseRev) ? Number(body.baseRev) : 0;

  try {
    const result = await writeLedger(payload, baseRev);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return handleError(error);
  }
}
