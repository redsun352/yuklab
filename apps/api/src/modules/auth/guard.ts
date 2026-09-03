import type { FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify } from "jose";

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error("JWT_SECRET must be at least 32 characters long");
  return new TextEncoder().encode(value);
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return reply.code(401).send({ error: "UNAUTHORIZED" });
  try {
    const { payload } = await jwtVerify(header.slice(7), secret());
    if (!payload.sub) return reply.code(401).send({ error: "INVALID_ACCESS_TOKEN" });
    request.user = { id: payload.sub, role: String(payload.role ?? "CUSTOMER") };
  } catch {
    return reply.code(401).send({ error: "INVALID_ACCESS_TOKEN" });
  }
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    if (!request.user || !roles.includes(request.user.role)) return reply.code(403).send({ error: "FORBIDDEN" });
  };
}
