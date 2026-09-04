import "fastify";
import type { UserRole } from "@yuklab/database";

declare module "fastify" {
  interface FastifyRequest {
    user?: {
      id: string;
      role: UserRole;
    };
  }
}
