export const USER_ROLES = [
  "CUSTOMER",
  "DRIVER",
  "SERVICE_PROVIDER",
  "BUSINESS",
  "ADMIN",
  "SUPER_ADMIN",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export type SupportedLocale = "tr-TR" | "en-US";

export type CurrencyCode = "TRY" | "USD" | "EUR";

export type OrderStatus =
  | "DRAFT"
  | "PUBLISHED"
  | "OFFERING"
  | "ACCEPTED"
  | "DRIVER_ASSIGNED"
  | "EN_ROUTE_PICKUP"
  | "ARRIVED_PICKUP"
  | "LOADED"
  | "IN_TRANSIT"
  | "ARRIVED_DELIVERY"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED"
  | "DISPUTED";

export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}
