export class AuthError extends Error {
  constructor(message: string, public readonly code: "INVALID_CREDENTIALS" | "UNAUTHORIZED" | "FORBIDDEN" = "UNAUTHORIZED") {
    super(message);
    this.name = "AuthError";
  }
}
