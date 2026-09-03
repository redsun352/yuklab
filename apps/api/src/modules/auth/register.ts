import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import { hashPassword } from "./service";

export async function registerRoutes(app: FastifyInstance) {
  app.post<{ Body: { email?: string; phone?: string; password: string; firstName: string; lastName: string; preferredLanguage?: string } }>(
    "/v1/auth/register",
    async (request, reply) => {
      const email = request.body.email?.trim().toLowerCase();
      const phone = request.body.phone?.trim();
      const firstName = request.body.firstName?.trim();
      const lastName = request.body.lastName?.trim();
      const password = request.body.password;

      if ((!email && !phone) || !firstName || !lastName || password.length < 8) {
        return reply.code(400).send({ error: "INVALID_INPUT" });
      }

      const existing = await prisma.user.findFirst({
        where: {
          OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(Boolean) as Array<{ email?: string; phone?: string }>,
        },
      });

      if (existing) return reply.code(409).send({ error: "ACCOUNT_EXISTS" });

      const user = await prisma.user.create({
        data: {
          email,
          phone,
          firstName,
          lastName,
          preferredLanguage: request.body.preferredLanguage ?? "tr-TR",
          passwordHash: await hashPassword(password),
          status: "ACTIVE",
        },
        select: { id: true, email: true, phone: true, firstName: true, lastName: true, preferredLanguage: true, role: true, status: true },
      });

      return reply.code(201).send({ user });
    },
  );
}
