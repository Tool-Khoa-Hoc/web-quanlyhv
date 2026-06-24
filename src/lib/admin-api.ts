import type {
  ApiAdminStatus,
  ApiGroup,
  ApiGroupRole,
  ApiMember,
  DomainMember,
  TrialRecord,
  TrialStatus,
} from "./admin-types";
import type {
  Ctv,
  CourseGroup,
  Enrollment,
  GroupJob,
  GroupMember,
  GroupRole,
  Settings,
  Student,
} from "./types";

// ===== Client gọi tới backend /api/admin/* =====

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string }).error || `Lỗi ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export async function fetchGroups(): Promise<ApiGroup[]> {
  const res = await fetch("/api/admin/groups", { cache: "no-store" });
  const data = await jsonOrThrow<{ groups: ApiGroup[] }>(res);
  return data.groups;
}

export async function fetchAdminStatus(): Promise<ApiAdminStatus> {
  const res = await fetch("/api/admin/status", { cache: "no-store" });
  return jsonOrThrow<ApiAdminStatus>(res);
}

/** Thành viên nội bộ (thuộc domain) trong nhóm học thử — dùng cho dropdown chọn CTV. */
export async function fetchDomainMembers(): Promise<DomainMember[]> {
  const res = await fetch("/api/admin/domain-members", { cache: "no-store" });
  const data = await jsonOrThrow<{ members: DomainMember[] }>(res);
  return data.members;
}

export async function fetchMembers(groupEmail: string): Promise<ApiMember[]> {
  const res = await fetch(`/api/admin/groups/${encodeURIComponent(groupEmail)}/members`, {
    cache: "no-store",
  });
  const data = await jsonOrThrow<{ members: ApiMember[] }>(res);
  return data.members;
}

export async function apiAddMember(
  groupEmail: string,
  email: string,
  role: GroupRole,
): Promise<ApiMember> {
  const res = await fetch(`/api/admin/groups/${encodeURIComponent(groupEmail)}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role: roleToApi(role) }),
  });
  const data = await jsonOrThrow<{ member: ApiMember }>(res);
  return data.member;
}

export async function apiRemoveMember(
  groupEmail: string,
  memberEmail: string,
): Promise<{ missing: boolean }> {
  const res = await fetch(
    `/api/admin/groups/${encodeURIComponent(groupEmail)}/members/${encodeURIComponent(memberEmail)}`,
    { method: "DELETE" },
  );
  const data = await jsonOrThrow<{ ok: boolean; missing?: boolean }>(res);
  return { missing: Boolean(data.missing) };
}

export async function apiUpdateRole(
  groupEmail: string,
  memberEmail: string,
  role: GroupRole,
): Promise<ApiMember> {
  const res = await fetch(
    `/api/admin/groups/${encodeURIComponent(groupEmail)}/members/${encodeURIComponent(memberEmail)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: roleToApi(role) }),
    },
  );
  const data = await jsonOrThrow<{ member: ApiMember }>(res);
  return data.member;
}

// ===== Kho học thử dùng chung (Google Sheet qua /api/trials) =====

export async function fetchTrialRecords(): Promise<TrialRecord[]> {
  const res = await fetch("/api/trials", { cache: "no-store" });
  const data = await jsonOrThrow<{ records: TrialRecord[] }>(res);
  return data.records;
}

/**
 * Thêm học viên vào nhóm học thử + ghi khóa học thử lên kho chung.
 * Mặc định gắn email CTV đang đăng nhập; admin có thể chỉ định `ctvEmail`
 * để gắn cho một CTV (tài khoản domain) khác.
 */
export async function apiAddTrial(
  groupEmail: string,
  email: string,
  name: string,
  trialCourse: string,
  ctvEmail?: string,
  ctvName?: string,
): Promise<{ member: ApiMember; record: TrialRecord }> {
  const res = await fetch("/api/trials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupKey: groupEmail, email, name, trialCourse, ctvEmail, ctvName }),
  });
  return jsonOrThrow<{ member: ApiMember; record: TrialRecord }>(res);
}

export async function apiUpdateTrialStatus(
  groupEmail: string,
  email: string,
  status: TrialStatus,
): Promise<void> {
  const res = await fetch("/api/trials", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupKey: groupEmail, email, status }),
  });
  await jsonOrThrow<{ ok: boolean }>(res);
}

// ===== Sổ cái nghiệp vụ dùng chung (CTV / học viên / giao dịch) qua /api/ledger =====

export interface LedgerPayload {
  ctvs: Ctv[];
  students: Student[];
  enrollments: Enrollment[];
  jobs: GroupJob[];
  settings: Settings;
}

export interface LedgerData extends LedgerPayload {
  rev: number;
  updatedAt: string;
}

/** Đọc sổ cái từ server. null = chưa cấu hình KV hoặc chưa từng ghi (client dùng localStorage). */
export async function fetchLedger(): Promise<LedgerData | null> {
  const res = await fetch("/api/ledger", { cache: "no-store" });
  const data = await jsonOrThrow<{ ledger: LedgerData | null }>(res);
  return data.ledger;
}

export interface LedgerWriteResult {
  ok: boolean;
  ledger: LedgerData;
}

/**
 * Ghi sổ cái với kiểm tra đụng độ theo rev.
 * - 200 → { ok: true, ledger }.
 * - 409 → { ok: false, ledger } (server mới hơn; client cần hợp nhất rồi ghi lại).
 */
export async function saveLedger(
  payload: LedgerPayload,
  baseRev: number,
): Promise<LedgerWriteResult> {
  const res = await fetch("/api/ledger", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload, baseRev }),
  });
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, ledger: (data as { ledger: LedgerData }).ledger };
  }
  return jsonOrThrow<LedgerWriteResult>(res);
}

// ===== Mapping giữa DTO của Admin SDK và model của app =====

export function roleToApi(role: GroupRole): ApiGroupRole {
  return role.toUpperCase() as ApiGroupRole;
}

export function roleFromApi(role: ApiGroupRole): GroupRole {
  return role.toLowerCase() as GroupRole;
}

/** Suy ra môn / giáo viên / loại từ tên nhóm "[2K9] Toán - Thầy A" giống seed cũ. */
export function apiGroupToCourseGroup(group: ApiGroup): CourseGroup {
  const name = group.name || group.email;
  const base = name.replace(/^\[2K9\]\s*/, "").trim();
  const dashIndex = base.indexOf(" - ");
  const subject = dashIndex >= 0 ? base.slice(0, dashIndex).trim() : base;
  const teacher = dashIndex >= 0 ? base.slice(dashIndex + 3).trim() : "Full Giáo Viên";
  const lower = name.toLowerCase();
  const kind: CourseGroup["kind"] = lower.includes("học thử")
    ? "trial"
    : lower.includes("combo")
      ? "combo"
      : "paid";
  return {
    id: `grp-${group.email}`,
    name,
    groupEmail: group.email,
    subject,
    teacher,
    kind,
    priceHint: 0,
    directMembersCount: group.directMembersCount,
  };
}

export function apiMemberToGroupMember(groupId: string, member: ApiMember): GroupMember {
  return {
    id: `mem-${groupId}-${member.email}`,
    groupId,
    email: member.email.toLowerCase(),
    role: roleFromApi(member.role),
    joinDate: "",
  };
}
