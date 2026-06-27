function cleanText(value: unknown): string | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text && text !== "[object Object]" ? text : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function messageFromNested(value: unknown, seen: WeakSet<object>): string | null {
  const text = cleanText(value);
  if (text) return text;
  if (value && typeof value === "object") {
    return getErrorMessageInternal(value, "", false, seen) || null;
  }
  return null;
}

function getErrorMessageInternal(
  error: unknown,
  fallback: string,
  includeJsonFallback: boolean,
  seen: WeakSet<object>,
): string {
  if (error instanceof Error) {
    return error.message || fallback;
  }

  const text = cleanText(error);
  if (text) return text;

  if (!error || typeof error !== "object") {
    return fallback;
  }

  if (seen.has(error)) return fallback;
  seen.add(error);

  const record = error as Record<string, unknown>;
  const parts = [
    messageFromNested(record.error, seen) ?? messageFromNested(record.message, seen),
    cleanText(record.details),
    cleanText(record.hint),
  ].filter((part): part is string => Boolean(part));

  const code = cleanText(record.code);
  if (code) parts.push(`Mã lỗi: ${code}`);

  const uniqueParts = Array.from(new Set(parts));
  if (uniqueParts.length) return uniqueParts.join(" ");

  if (!includeJsonFallback) return fallback;

  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
}

export function getErrorMessage(error: unknown, fallback = "Lỗi không xác định."): string {
  return getErrorMessageInternal(error, fallback, true, new WeakSet<object>());
}
