import { createHash, randomBytes } from "node:crypto";
import type { UserRole } from "@yuklab/types";

export type AccessTokenPayload = {
  sub: string;
  role: UserRole;
  sessionId: string;
};

export function createOpaqueRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
