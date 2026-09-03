export type AuthRole =
  | "CUSTOMER"
  | "DRIVER"
  | "SERVICE_PROVIDER"
  | "BUSINESS"
  | "ADMIN"
  | "SUPER_ADMIN";

export interface AuthUser {
  id: string;
  email: string;
  roles: AuthRole[];
}
