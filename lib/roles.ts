/**
 * Shared role definitions and permission helpers.
 *
 * Role hierarchy: owner > admin > designer > editor
 */

export const ALL_ROLES = ['owner', 'admin', 'designer', 'editor'] as const;
export type UserRole = (typeof ALL_ROLES)[number];

export const ASSIGNABLE_ROLES = ['admin', 'designer', 'editor'] as const;
// Fail closed: unknown/missing roles resolve to the least-privileged role.
export const DEFAULT_ROLE: UserRole = 'editor';

export function resolveRole(raw: string | undefined | null): UserRole {
  if (raw && ALL_ROLES.includes(raw as UserRole)) return raw as UserRole;
  return DEFAULT_ROLE;
}

export function extractRoleFromUser(user: { app_metadata?: Record<string, unknown> } | null): UserRole | null {
  if (!user) return null;
  const rawRole = user.app_metadata?.role;
  return resolveRole(typeof rawRole === 'string' ? rawRole : undefined);
}

export function canManageMembers(role: UserRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function canEditStructure(role: UserRole): boolean {
  return role !== 'editor';
}

export function canManageSettings(role: UserRole): boolean {
  return role !== 'editor';
}
