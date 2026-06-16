import "server-only";

import { Redis } from "@upstash/redis";

// ===== Kết nối Redis dùng chung (Vercel KV / Upstash) =====
// Vercel KV chạy trên Upstash Redis. Khi tạo KV trong tab Storage của Vercel,
// các biến môi trường được gắn tự động (KV_REST_API_URL/KV_REST_API_TOKEN
// hoặc UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN). Local: copy vào .env.local.

export class KvStoreError extends Error {}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function resolveUrl(): string | undefined {
  return readEnv("KV_REST_API_URL") ?? readEnv("UPSTASH_REDIS_REST_URL");
}

function resolveToken(): string | undefined {
  return readEnv("KV_REST_API_TOKEN") ?? readEnv("UPSTASH_REDIS_REST_TOKEN");
}

export function isKvConfigured(): boolean {
  return Boolean(resolveUrl() && resolveToken());
}

let cached: Redis | null = null;

export function getRedis(): Redis {
  if (cached) return cached;
  const url = resolveUrl();
  const token = resolveToken();
  if (!url || !token) {
    throw new KvStoreError(
      "Chưa cấu hình kho dữ liệu (thiếu KV_REST_API_URL/KV_REST_API_TOKEN hoặc UPSTASH_REDIS_REST_URL/TOKEN).",
    );
  }
  // Tắt auto (de)serialize để tự kiểm soát JSON, tránh lỗi parse 2 lần.
  cached = new Redis({ url, token, automaticDeserialization: false });
  return cached;
}
