import type { UserRole } from "@yuklab/types";

export function hasAnyRole(userRole: UserRole, allowedRoles: readonly UserRole[]): boolean {
  return allowedRoles.includes(userRole);
}

export function assertRole(userRole: UserRole, allowedRoles: readonly UserRole[]): void {
  if (!hasAnyRole(userRole, allowedRoles)) {
    const error = new Error("FORBIDDEN");
    error.name = "AuthorizationError";
    throw error;
  }
}
