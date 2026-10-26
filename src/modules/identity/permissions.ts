export const ROLES = ["owner", "admin", "member"] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "tenant.manage",
  "members.read",
  "members.manage",
  "audit.read",
  "settings.manage",
  "data.read",
  "data.write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [
    "tenant.manage",
    "members.read",
    "members.manage",
    "audit.read",
    "settings.manage",
    "data.read",
    "data.write",
  ],
  admin: [
    "members.read",
    "members.manage",
    "audit.read",
    "settings.manage",
    "data.read",
    "data.write",
  ],
  member: ["data.read", "data.write"],
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function selectDefaultMembership<T extends { role: Role; createdAt: Date }>(
  memberships: readonly T[],
): T | undefined {
  const priority: Record<Role, number> = { owner: 0, admin: 1, member: 2 };
  return [...memberships].sort(
    (a, b) => priority[a.role] - priority[b.role] || a.createdAt.getTime() - b.createdAt.getTime(),
  )[0];
}
