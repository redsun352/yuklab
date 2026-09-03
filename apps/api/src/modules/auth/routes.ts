import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../../lib/prisma";
import { createRefreshToken, hashPassword, hashToken, verifyPassword } from "./service";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_DAYS = 30;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be configured and at least 32 characters long");
  }
  return secret;
}

async function issueAccessToken(userId: string, role: string): Promise<string> {
  const { SignJWT } = await import("jose");
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(getJwtSecret()));
}

function sanitizeUser(user: {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  preferredLanguage: string;
  role: string;
  status: string;
}) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    preferredLanguage: user.preferredLanguage,
    role: user.role,
    status: user.status,
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: {
    email?: string;
    phone?: string;
    password: string;
    firstName: string;
    lastName: string;
    preferredLanguage?: string;
  } }>("/v1/auth/register", async (request, reply) => {
    const { email, phone, password, firstName, lastName, preferredLanguage } = request.body;
    if ((!email && !phone) || password.length < 8 || !firstName?.trim() || !lastName?.trim()) {
      return reply.code(400).send({ error: "INVALID_INPUT" });
    }

    const normalizedEmail = email?.trim().toLowerCase();
    const normalizedPhone = phone?.trim();
    const existing = await prisma.user.findFirst({ where: { OR: [
      normalizedEmail ? { email: normalizedEmail } : undefined,
      normalizedPhone ? { phone: normalizedPhone } : undefined,
    ].filter(Boolean) as Array<{ email?: string; phone?: string }> } });

    if (existing) return reply.code(409).send({ error: "ACCOUNT_EXISTS" });

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        phone: normalizedPhone,
        passwordHash,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        preferredLanguage: preferredLanguage || "tr-TR",
        status: "ACTIVE",
      },
    });

    return reply.code(201).send({ user: sanitizeUser(user) });
  });

  app.post<{ Body: { identifier: string; password: string } }>("/v1/auth/login", async (request, reply) => {
    const identifier = request.body.identifier.trim().toLowerCase();
    const user = await prisma.user.findFirst({ where: {
      OR: [{ email: identifier }, { phone: request.body.identifier.trim() }],
      status: { not: "DELETED" },
    } });

    if (!user?.passwordHash || !(await verifyPassword(request.body.password, user.passwordHash))) {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    }
    if (user.status === "SUSPENDED") return reply.code(403).send({ error: "ACCOUNT_SUSPENDED" });

    const refreshToken = createRefreshToken();
    const refreshTokenHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400000);
    await prisma.authSession.create({ data: { userId: user.id, refreshTokenHash, expiresAt } });
    const accessToken = await issueAccessToken(user.id, user.role);

    return reply.send({ accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, user: sanitizeUser(user) });
  });

  app.post<{ Body: { refreshToken: string } }>("/v1/auth/refresh", async (request, reply) => {
    const oldHash = hashToken(request.body.refreshToken);
    const session = await prisma.authSession.findUnique({ where: { refreshTokenHash: oldHash }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status === "DELETED") {
      return reply.code(401).send({ error: "INVALID_REFRESH_TOKEN" });
    }

    const nextRefreshToken = createRefreshToken();
    const nextHash = hashToken(nextRefreshToken);
    await prisma.$transaction([
      prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), lastUsedAt: new Date() } }),
      prisma.authSession.create({ data: { userId: session.userId, refreshTokenHash: nextHash, expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400000) } }),
    ]);
    const accessToken = await issueAccessToken(session.user.id, session.user.role);
    return reply.send({ accessToken, refreshToken: nextRefreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  });

  app.post<{ Body: { refreshToken: string } }>("/v1/auth/logout", async (request, reply) => {
    await prisma.authSession.updateMany({ where: { refreshTokenHash: hashToken(request.body.refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    return reply.code(204).send();
  });
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return reply.code(401).send({ error: "UNAUTHORIZED" });
  try {
    const { jwtVerify } = await import("jose");
    const { payload } = await jwtVerify(authorization.slice(7), new TextEncoder().encode(getJwtSecret()));
    if (!payload.sub) return reply.code(401).send({ error: "UNAUTHORIZED" });
    request.user = { id: payload.sub, role: String(payload.role || "CUSTOMER") };
  } catch {
    return reply.code(401).send({ error: "INVALID_ACCESS_TOKEN" });
  }
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    const role = request.user?.role;
    if (!role || !roles.includes(role)) return reply.code(403).send({ error: "FORBIDDEN" });
  };
}
