import type { FastifyReply, FastifyRequest } from "fastify";
import { UserRole } from "@yuklab/database";
import { jwtVerify } from "jose";
import { prisma } from "../../lib/prisma";

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error("JWT_SECRET must be at least 32 characters long");
  return new TextEncoder().encode(value);
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return reply.code(401).send({ error: "UNAUTHORIZED" });

  try {
    const token = header.slice(7).trim();
    if (!token) return reply.code(401).send({ error: "INVALID_ACCESS_TOKEN" });

    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return reply.code(401).send({ error: "INVALID_ACCESS_TOKEN" });
    }

    // The JWT is only proof of authentication. Role/status are read from the
    // database so a suspension, deletion or role change takes effect immediately
    // instead of waiting for the access token to expire.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, status: true },
    });
    if (!user || user.status !== "ACTIVE") {
      return reply.code(401).send({ error: "ACCOUNT_NOT_ACTIVE" });
    }

    request.user = { id: user.id, role: user.role };
  } catch {
    return reply.code(401).send({ error: "INVALID_ACCESS_TOKEN" });
  }
}

export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    if (!request.user || !roles.includes(request.user.role)) return reply.code(403).send({ error: "FORBIDDEN" });
  };
}
