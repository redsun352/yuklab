import type { AuthRole, AuthUser } from "./auth.types";

export function hasRole(user: AuthUser, role: AuthRole): boolean {
  return user.roles.includes(role);
}

export function hasAnyRole(user: AuthUser, roles: AuthRole[]): boolean {
  return roles.some((role) => hasRole(user, role));
}
