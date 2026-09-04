import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "./guard";
import { createRefreshToken, hashPassword, hashToken, verifyPassword } from "./service";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_LENGTH = 32;
const MAX_PASSWORD_LENGTH = 128;
const MAX_LANGUAGE_LENGTH = 16;

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

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email?: string; phone?: string; password: string; firstName: string; lastName: string; preferredLanguage?: string } }>(
    "/v1/auth/register",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = request.body;
      if (!body || typeof body !== "object") return reply.code(400).send({ error: "INVALID_INPUT" });

      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
      const phone = typeof body.phone === "string" ? body.phone.trim() : undefined;
      const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
      const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const preferredLanguage = typeof body.preferredLanguage === "string" ? body.preferredLanguage.trim() : "tr-TR";

      if ((!email && !phone) || (email !== undefined && (!isBoundedString(email, MAX_EMAIL_LENGTH) || !email.includes("@"))) || (phone !== undefined && !isBoundedString(phone, MAX_PHONE_LENGTH)) || !isBoundedString(firstName, MAX_NAME_LENGTH) || !isBoundedString(lastName, MAX_NAME_LENGTH) || password.length < 8 || password.length > MAX_PASSWORD_LENGTH || !isBoundedString(preferredLanguage, MAX_LANGUAGE_LENGTH)) {
        return reply.code(400).send({ error: "INVALID_INPUT" });
      }

      const existing = await prisma.user.findFirst({ where: { OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(Boolean) as Array<{ email?: string; phone?: string }> } });
      if (existing) return reply.code(409).send({ error: "ACCOUNT_EXISTS" });

      const user = await prisma.user.create({ data: { email, phone, firstName, lastName, preferredLanguage, passwordHash: await hashPassword(password), status: "ACTIVE" } });
      return reply.code(201).send({ user: publicUser(user) });
    },
  );

  app.post<{ Body: { identifier: string; password: string } }>(
    "/v1/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const identifier = typeof request.body?.identifier === "string" ? request.body.identifier.trim() : "";
      const password = typeof request.body?.password === "string" ? request.body.password : "";
      if (!isBoundedString(identifier, Math.max(MAX_EMAIL_LENGTH, MAX_PHONE_LENGTH)) || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
        return reply.code(400).send({ error: "INVALID_INPUT" });
      }

      const normalizedEmail = identifier.toLowerCase();
      const user = await prisma.user.findFirst({ where: { OR: [{ email: normalizedEmail }, { phone: identifier }] } });
      if (!user || user.status === "DELETED" || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
      if (user.status === "SUSPENDED") return reply.code(403).send({ error: "ACCOUNT_SUSPENDED" });

      const refreshToken = createRefreshToken();
      await prisma.authSession.create({ data: { userId: user.id, refreshTokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) } });
      const accessToken = await issueAccessToken(user.id, user.role);
      return { accessToken, refreshToken, expiresIn: 900, user: publicUser(user) };
    },
  );

  app.post<{ Body: { refreshToken: string } }>(
    "/v1/auth/refresh",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const refreshToken = typeof request.body?.refreshToken === "string" ? request.body.refreshToken : "";
      if (!isBoundedString(refreshToken, 512)) return reply.code(400).send({ error: "INVALID_INPUT" });
      const current = await prisma.authSession.findUnique({ where: { refreshTokenHash: hashToken(refreshToken) }, include: { user: true } });
      if (!current || current.revokedAt || current.expiresAt <= new Date() || current.user.status !== "ACTIVE") return reply.code(401).send({ error: "INVALID_REFRESH_TOKEN" });

      const nextRefreshToken = createRefreshToken();
      await prisma.$transaction([
        prisma.authSession.update({ where: { id: current.id }, data: { revokedAt: new Date(), lastUsedAt: new Date() } }),
        prisma.authSession.create({ data: { userId: current.userId, refreshTokenHash: hashToken(nextRefreshToken), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) } }),
      ]);
      return { accessToken: await issueAccessToken(current.user.id, current.user.role), refreshToken: nextRefreshToken, expiresIn: 900 };
    },
  );

  app.post<{ Body: { refreshToken: string } }>("/v1/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    const refreshToken = typeof request.body?.refreshToken === "string" ? request.body.refreshToken : "";
    if (refreshToken.length > 0 && refreshToken.length <= 512) {
      await prisma.authSession.updateMany({ where: { userId: request.user!.id, refreshTokenHash: hashToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return reply.code(204).send();
  });

  app.post<{ Body: { category?: string } }>("/v1/auth/become-provider", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user!.id;
    const category = typeof request.body?.category === "string" && request.body.category.trim().length <= 80 ? request.body.category.trim() || "GENERAL" : "GENERAL";
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { driverProfile: true, serviceProvider: true } });
    if (!user || user.status !== "ACTIVE") return reply.code(403).send({ error: "ACCOUNT_NOT_ACTIVE" });
    if (user.role !== "CUSTOMER" && user.role !== "DRIVER" && user.role !== "SERVICE_PROVIDER") return reply.code(403).send({ error: "ROLE_NOT_ELIGIBLE" });

    const updated = await prisma.$transaction(async (tx) => {
      if (user.role === "CUSTOMER") {
        await tx.user.update({ where: { id: userId }, data: { role: "DRIVER" } });
      }
      await tx.driverProfile.upsert({ where: { userId }, create: { userId, isOnline: false, isAvailable: false }, update: {} });
      return tx.user.findUniqueOrThrow({ where: { id: userId } });
    });

    return { user: publicUser(updated), provider: { category, isOnline: false, isAvailable: false } };
  });
}
