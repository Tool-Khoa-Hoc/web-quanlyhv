// Hợp nhất 3 chiều cho sổ cái dùng chung (/api/ledger).
//
// Vì sao cần: sổ cái được ghi theo kiểu "cả cục JSON + rev". Trước đây khi đụng
// độ rev (thiết bị/tab khác vừa ghi) hoặc khi poll thấy rev mới hơn, client
// NHẬN NGUYÊN bản server và bỏ hết thay đổi cục bộ → học viên vừa thêm ở tab này
// biến mất khỏi khóa (dù đã vào Google Group thật). Giờ mọi lần nhận dữ liệu
// server đều hợp nhất theo id với mốc "bản server đã biết" (base):
//
//   - chỉ có ở local, base không có   → bản ghi mới chưa kịp đẩy  → GIỮ
//   - chỉ có ở local, base có         → thiết bị khác đã xóa      → bỏ
//   - chỉ có ở server, base không có  → thiết bị khác vừa thêm    → GIỮ
//   - chỉ có ở server, base có        → mình vừa xóa              → bỏ
//   - có ở cả hai                     → local khác base ? local : server
//
// Nhờ đó không có chiều nào mất bản ghi: thêm ở đâu cũng còn, xóa ở đâu cũng xóa.

import { trimJobHistory } from "./job-history";
import type { AppState, Ctv, Enrollment, Expense, GroupJob, Settings, Student } from "./types";

export interface LedgerSnapshot {
  ctvs: Ctv[];
  students: Student[];
  enrollments: Enrollment[];
  expenses: Expense[];
  jobs: GroupJob[];
  settings: Settings;
}

/**
 * Chuỗi hóa ổn định: khóa object được sắp xếp nên không phụ thuộc thứ tự khóa.
 * Cần thiết vì dữ liệu đi qua Redis/JSON có thể về với thứ tự khóa khác.
 */
function stableKey(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableKey(obj[key])}`).join(",")}}`;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableKey(a) === stableKey(b);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

type WithId = { id?: string };

function indexById<T extends WithId>(list: T[]): Map<string, T> {
  const map = new Map<string, T>();
  list.forEach((item) => {
    if (!item || typeof item !== "object") return;
    // Bản ghi thiếu id (dữ liệu cũ/lỗi) vẫn phải so khớp được → dùng nội dung làm khóa.
    const key = typeof item.id === "string" && item.id ? item.id : `#${stableKey(item)}`;
    if (!map.has(key)) map.set(key, item);
  });
  return map;
}

/** Hợp nhất 1 danh sách bản ghi có id theo luật 3 chiều mô tả ở đầu file. */
export function mergeById<T extends WithId>(base: T[], local: T[], server: T[]): T[] {
  const baseMap = indexById(base);
  const localMap = indexById(local);
  const serverMap = indexById(server);
  const result: T[] = [];
  const taken = new Set<string>();

  // Bản ghi mới tạo ở máy này (chưa có trên server, base cũng chưa có) → xếp trước
  // cho khớp quy ước "mới nhất lên đầu" của app.
  for (const [key, item] of localMap) {
    if (serverMap.has(key) || baseMap.has(key)) continue;
    result.push(item);
    taken.add(key);
  }

  for (const [key, serverItem] of serverMap) {
    if (taken.has(key)) continue;
    taken.add(key);
    const localItem = localMap.get(key);
    if (!localItem) {
      // Local không còn: base có nghĩa là mình vừa xóa → tôn trọng việc xóa.
      if (baseMap.has(key)) continue;
      result.push(serverItem);
      continue;
    }
    const baseItem = baseMap.get(key);
    const localEdited = baseItem !== undefined && !deepEqual(localItem, baseItem);
    result.push(localEdited ? localItem : serverItem);
  }

  return result;
}

function mergeSettings(base: Settings, local: Settings, server: Settings): Settings {
  // Chỉ những thông số máy này vừa sửa (khác base) mới ghi đè bản server.
  const merged = { ...server } as Record<string, unknown>;
  for (const key of Object.keys(local)) {
    const localValue = (local as unknown as Record<string, unknown>)[key];
    const baseValue = (base as unknown as Record<string, unknown>)[key];
    if (!deepEqual(localValue, baseValue)) merged[key] = localValue;
  }
  return merged as unknown as Settings;
}

/**
 * Bù các bản ghi bị tham chiếu nhưng đã rơi mất (ví dụ đăng ký mới ở máy này trỏ
 * tới học viên mà server chưa có) để không sinh dòng "mồ côi" trên bảng.
 */
function restoreReferenced(merged: LedgerSnapshot, local: LedgerSnapshot): LedgerSnapshot {
  const studentIds = new Set(merged.students.map((item) => item.id));
  const ctvIds = new Set(merged.ctvs.map((item) => item.id));
  const missingStudents: Student[] = [];
  const missingCtvs: Ctv[] = [];

  for (const enrollment of merged.enrollments) {
    if (!studentIds.has(enrollment.studentId)) {
      const student = local.students.find((item) => item.id === enrollment.studentId);
      if (student) {
        studentIds.add(student.id);
        missingStudents.push(student);
      }
    }
    if (!ctvIds.has(enrollment.ctvId)) {
      const ctv = local.ctvs.find((item) => item.id === enrollment.ctvId);
      if (ctv) {
        ctvIds.add(ctv.id);
        missingCtvs.push(ctv);
      }
    }
  }

  if (!missingStudents.length && !missingCtvs.length) return merged;
  return {
    ...merged,
    students: [...missingStudents, ...merged.students],
    ctvs: [...missingCtvs, ...merged.ctvs],
  };
}

export function snapshotFromState(state: AppState): LedgerSnapshot {
  return {
    ctvs: asArray<Ctv>(state.ctvs),
    students: asArray<Student>(state.students),
    enrollments: asArray<Enrollment>(state.enrollments),
    expenses: asArray<Expense>(state.expenses),
    // Trim giống lúc ghi lên server để so sánh "có gì mới không" hội tụ được.
    jobs: trimJobHistory(asArray<GroupJob>(state.jobs)),
    settings: state.settings,
  };
}

/** Chuẩn hóa dữ liệu server: mọi danh sách phải là array (ledger cũ có thể lưu `{}`). */
export function snapshotFromLedger(
  ledger: Partial<LedgerSnapshot>,
  fallbackSettings: Settings,
): LedgerSnapshot {
  return {
    ctvs: asArray<Ctv>(ledger.ctvs),
    students: asArray<Student>(ledger.students),
    enrollments: asArray<Enrollment>(ledger.enrollments),
    expenses: asArray<Expense>(ledger.expenses),
    jobs: trimJobHistory(asArray<GroupJob>(ledger.jobs)),
    settings: { ...fallbackSettings, ...(ledger.settings ?? {}) },
  };
}

export function sameSnapshot(a: LedgerSnapshot, b: LedgerSnapshot): boolean {
  return (
    deepEqual(a.ctvs, b.ctvs) &&
    deepEqual(a.students, b.students) &&
    deepEqual(a.enrollments, b.enrollments) &&
    deepEqual(a.expenses, b.expenses) &&
    deepEqual(a.jobs, b.jobs) &&
    deepEqual(a.settings, b.settings)
  );
}

/**
 * Hợp nhất bản local với bản server dựa trên `base` = bản server mà client đã biết.
 * `changed` = bản hợp nhất còn khác server → cần ghi lại lên server.
 */
export function mergeLedger(
  base: LedgerSnapshot,
  local: LedgerSnapshot,
  server: LedgerSnapshot,
): { merged: LedgerSnapshot; changed: boolean } {
  const merged = restoreReferenced(
    {
      ctvs: mergeById(base.ctvs, local.ctvs, server.ctvs),
      students: mergeById(base.students, local.students, server.students),
      enrollments: mergeById(base.enrollments, local.enrollments, server.enrollments),
      expenses: mergeById(base.expenses, local.expenses, server.expenses),
      jobs: trimJobHistory(mergeById(base.jobs, local.jobs, server.jobs)),
      settings: mergeSettings(base.settings, local.settings, server.settings),
    },
    local,
  );
  return { merged, changed: !sameSnapshot(merged, server) };
}
