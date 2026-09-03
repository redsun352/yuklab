import type { AuthUser } from "./auth.types";
import { AuthError } from "./auth.errors";

/**
 * Authentication service boundary.
 * Provider-specific password/JWT implementation belongs behind this interface
 * so the rest of the API never depends directly on a token library.
 */
export interface AuthService {
  authenticate(email: string, password: string): Promise<AuthUser>;
}

export class UnconfiguredAuthService implements AuthService {
  async authenticate(_email: string, _password: string): Promise<AuthUser> {
    void _email;
    void _password;

    throw new AuthError(
      "Authentication provider is not configured.",
      "UNAUTHORIZED",
    );
  }
}
