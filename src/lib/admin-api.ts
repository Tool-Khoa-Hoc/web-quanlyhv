import type { ApiAdminStatus, ApiGroup, ApiGroupRole, ApiMember } from "./admin-types";
import type { CourseGroup, GroupMember, GroupRole } from "./types";

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

export async function apiRemoveMember(groupEmail: string, memberEmail: string): Promise<void> {
  const res = await fetch(
    `/api/admin/groups/${encodeURIComponent(groupEmail)}/members/${encodeURIComponent(memberEmail)}`,
    { method: "DELETE" },
  );
  await jsonOrThrow<{ ok: boolean }>(res);
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
