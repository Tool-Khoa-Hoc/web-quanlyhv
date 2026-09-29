import { NextResponse } from "next/server";

import { rejectCrossSiteMutation, requireAdmin } from "@/lib/api-guard";
import { describeApiError } from "@/lib/google-admin";
import { checkRateLimit, isJsonBodyTooLarge, rateLimitKey } from "@/lib/validation";
import { trimJobHistory } from "@/lib/job-history";
import { KvStoreError } from "@/lib/kv";
import {
  isLedgerConfigured,
  readLedger,
  writeLedger,
  type LedgerPayload,
} from "@/lib/ledger-store";

export const dynamic = "force-dynamic";

const LEDGER_MAX_CHARS = 4_000_000;

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
  const rl = checkRateLimit(rateLimitKey(request, "ledger:write", session.email), 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Thao tác quá nhanh, thử lại sau." }, { status: 429 });
  }
  if (!isLedgerConfigured()) {
    return NextResponse.json({ error: "Chưa cấu hình kho dữ liệu." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    payload?: LedgerPayload;
    baseRev?: number;
  };
  // Chặn payload phình Redis (DoS). Sổ cái thật (vài nghìn học viên/đăng ký) đã
  // vượt 512KB → mức cũ chặn luôn cả thao tác hợp lệ. Đặt 4MB: dưới trần body
  // 4.5MB của Vercel Functions và vẫn đủ chặn ghi rác cỡ lớn.
  if (isJsonBodyTooLarge(body, LEDGER_MAX_CHARS)) {
    return NextResponse.json({ error: "Payload sổ cái quá lớn (tối đa ~4MB)." }, { status: 413 });
  }
  const payload = body.payload;
  if (
    !payload ||
    !Array.isArray(payload.ctvs) ||
    !Array.isArray(payload.students) ||
    !Array.isArray(payload.enrollments) ||
    !Array.isArray(payload.expenses) ||
    !Array.isArray(payload.jobs) ||
    !payload.settings ||
    typeof payload.settings !== "object"
  ) {
    return NextResponse.json({ error: "Payload sổ cái không hợp lệ." }, { status: 400 });
  }
  // Lịch sử jobs tăng mãi theo thao tác → chỉ lưu job đang xử lý + bản ghi gần nhất
  // (client cũ chưa tự cắt vẫn ghi được).
  payload.jobs = trimJobHistory(payload.jobs);
  // Giới hạn số lượng + kiểu để tránh ghi rác làm sập client render / tràn Redis.
  const limits: Array<[unknown[], number, string]> = [
    [payload.ctvs, 5000, "ctvs"],
    [payload.students, 20000, "students"],
    [payload.enrollments, 50000, "enrollments"],
    [payload.expenses, 20000, "expenses"],
    [payload.jobs, 5000, "jobs"],
  ];
  for (const [arr, max, name] of limits) {
    if (arr.length > max) {
      return NextResponse.json({ error: `Danh sách ${name} quá lớn.` }, { status: 400 });
    }
    if (!arr.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
      return NextResponse.json({ error: `Danh sách ${name} chứa mục không hợp lệ.` }, { status: 400 });
    }
  }
  const baseRev = Number.isFinite(body.baseRev) ? Math.floor(Number(body.baseRev)) : 0;
  if (baseRev < 0 || baseRev > 1_000_000_000) {
    return NextResponse.json({ error: "baseRev không hợp lệ." }, { status: 400 });
  }

  try {
    const result = await writeLedger(payload, baseRev);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return handleError(error);
  }
}
