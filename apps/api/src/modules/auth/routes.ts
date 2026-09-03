import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import { createRefreshToken, hashPassword, hashToken, verifyPassword } from "./service";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getJwtSecret() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error("JWT_SECRET must be at least 32 characters long");
  return new TextEncoder().encode(value);
}

async function issueAccessToken(userId: string, role: string) {
  const { SignJWT } = await import("jose");
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getJwtSecret());
}

function publicUser(user: { id: string; email: string | null; phone: string | null; firstName: string; lastName: string; preferredLanguage: string; role: string; status: string }) {
  return { id: user.id, email: user.email, phone: user.phone, firstName: user.firstName, lastName: user.lastName, preferredLanguage: user.preferredLanguage, role: user.role, status: user.status };
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email?: string; phone?: string; password: string; firstName: string; lastName: string; preferredLanguage?: string } }>("/v1/auth/register", async (request, reply) => {
    const email = request.body.email?.trim().toLowerCase();
    const phone = request.body.phone?.trim();
    const firstName = request.body.firstName?.trim();
    const lastName = request.body.lastName?.trim();

    if ((!email && !phone) || !firstName || !lastName || request.body.password.length < 8) {
      return reply.code(400).send({ error: "INVALID_INPUT" });
    }

    const existing = await prisma.user.findFirst({ where: { OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(Boolean) as Array<{ email?: string; phone?: string }> } });
    if (existing) return reply.code(409).send({ error: "ACCOUNT_EXISTS" });

    const user = await prisma.user.create({
      data: { email, phone, firstName, lastName, preferredLanguage: request.body.preferredLanguage ?? "tr-TR", passwordHash: await hashPassword(request.body.password), status: "ACTIVE" },
    });

    return reply.code(201).send({ user: publicUser(user) });
  });

  app.post<{ Body: { identifier: string; password: string } }>("/v1/auth/login", async (request, reply) => {
    const identifier = request.body.identifier.trim().toLowerCase();
    const user = await prisma.user.findFirst({ where: { OR: [{ email: identifier }, { phone: request.body.identifier.trim() }] } });
    if (!user || user.status === "DELETED" || !user.passwordHash || !(await verifyPassword(request.body.password, user.passwordHash))) {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    }
    if (user.status === "SUSPENDED") return reply.code(403).send({ error: "ACCOUNT_SUSPENDED" });

    const refreshToken = createRefreshToken();
    await prisma.authSession.create({ data: { userId: user.id, refreshTokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) } });
    const accessToken = await issueAccessToken(user.id, user.role);

    return { accessToken, refreshToken, expiresIn: 900, user: publicUser(user) };
  });

  app.post<{ Body: { refreshToken: string } }>("/v1/auth/refresh", async (request, reply) => {
    const current = await prisma.authSession.findUnique({ where: { refreshTokenHash: hashToken(request.body.refreshToken) }, include: { user: true } });
    if (!current || current.revokedAt || current.expiresAt <= new Date() || current.user.status !== "ACTIVE") return reply.code(401).send({ error: "INVALID_REFRESH_TOKEN" });

    const nextRefreshToken = createRefreshToken();
    await prisma.$transaction([
      prisma.authSession.update({ where: { id: current.id }, data: { revokedAt: new Date(), lastUsedAt: new Date() } }),
      prisma.authSession.create({ data: { userId: current.userId, refreshTokenHash: hashToken(nextRefreshToken), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) } }),
    ]);

    return { accessToken: await issueAccessToken(current.user.id, current.user.role), refreshToken: nextRefreshToken, expiresIn: 900 };
  });

  app.post<{ Body: { refreshToken: string } }>("/v1/auth/logout", async (request, reply) => {
    await prisma.authSession.updateMany({ where: { refreshTokenHash: hashToken(request.body.refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    return reply.code(204).send();
  });
}
