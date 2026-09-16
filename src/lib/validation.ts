import "server-only";

// Validation tập trung để tránh bypass ở từng route.

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/;
const GROUP_KEY_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export function isValidEmail(email: string): boolean {
  const v = email.trim();
  if (v.length > 254) return false;
  return EMAIL_RE.test(v.toLowerCase());
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** groupKey bắt buộc là email group hợp lệ, chống path-traversal / injection vào Directory API. */
export function isValidGroupKey(groupKey: string): boolean {
  const v = groupKey.trim();
  if (!v || v.length > 254 || v.includes("/") || v.includes("\\") || v.includes("..")) return false;
  return GROUP_KEY_RE.test(v.toLowerCase());
}

/** Chặn payload quá lớn trước khi JSON.parse sâu / ghi Redis. */
export function isJsonBodyTooLarge(body: unknown, maxBytes = 512_000): boolean {
  try {
    return JSON.stringify(body).length > maxBytes;
  } catch {
    return true;
  }
}

// ===== Rate-limit in-memory đơn giản (per-instance) =====
// Đủ để chặn spam/quota-exhaustion khi chưa có Upstash Ratelimit riêng.
// Trên serverless multi-instance thì đây là best-effort, không thay Redis-based limiter.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  limit = 30,
  windowMs = 60_000,
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || now >= cur.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0 };
  }
  if (cur.count < limit) {
    cur.count += 1;
    return { ok: true, retryAfterMs: 0 };
  }
  return { ok: false, retryAfterMs: cur.resetAt - now };
}

/** Key rate-limit theo actor (email) + IP forward (nếu có) + route. */
export function rateLimitKey(request: Request, route: string, actor = ""): string {
  const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  // Không tin IP tuyệt đối (có thể spoof qua header khi không qua proxy tin cậy),
  // chỉ dùng để tách bucket, quyết định chặn vẫn dựa trên actor + route.
  return `${route}|${actor.toLowerCase()}|${fwd}`;
}
