import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import { hashPassword, verifyPassword, createRefreshToken, hashToken } from "./service";

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email?: string; phone?: string; password: string; firstName: string; lastName: string } }>("/v1/auth/register", async (request, reply) => {
    const { email, phone, password, firstName, lastName } = request.body;
    if (!email && !phone) return reply.code(400).send({ error: "EMAIL_OR_PHONE_REQUIRED" });
    if (password.length < 8) return reply.code(400).send({ error: "WEAK_PASSWORD" });
    const existing = await prisma.user.findFirst({ where: { OR: [{ email: email ?? undefined }, { phone: phone ?? undefined }] } });
    if (existing) return reply.code(409).send({ error: "ACCOUNT_EXISTS" });
    const user = await prisma.user.create({
      data: { email, phone, firstName, lastName, passwordHash: await hashPassword(password), status: "ACTIVE" },
      select: { id: true, email: true, phone: true, firstName: true, lastName: true, role: true, preferredLanguage: true },
    });
    return reply.code(201).send({ user });
  });

  app.post<{ Body: { identifier: string; password: string } }>("/v1/auth/login", async (request, reply) => {
    const { identifier, password } = request.body;
    const user = await prisma.user.findFirst({ where: { OR: [{ email: identifier }, { phone: identifier }] } });
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash)) || user.status !== "ACTIVE") {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    }
    const refreshToken = createRefreshToken();
    await prisma.authSession.create({ data: { userId: user.id, refreshTokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) } });
    return { user: { id: user.id, email: user.email, phone: user.phone, firstName: user.firstName, lastName: user.lastName, role: user.role, preferredLanguage: user.preferredLanguage }, refreshToken };
  });

  app.post<{ Body: { refreshToken: string } }>("/v1/auth/logout", async (request, reply) => {
    await prisma.authSession.updateMany({ where: { refreshTokenHash: hashToken(request.body.refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    return reply.code(204).send();
  });
}
