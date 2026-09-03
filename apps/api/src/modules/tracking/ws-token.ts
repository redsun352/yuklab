import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../auth/guard";

function jwtSecret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error("JWT_SECRET must be at least 32 characters long");
  return new TextEncoder().encode(value);
}

export async function trackingWsTokenRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { orderId: string } }>(
    "/v1/tracking/orders/:orderId/ws-token",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.id;
      const order = await prisma.order.findFirst({
        where: {
          id: request.params.orderId,
          OR: [{ customerId: userId }, { assignedDriverId: userId }],
        },
        select: { id: true },
      });
      if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });

      const token = await new SignJWT({ typ: "tracking-ws", ord: order.id })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime("60s")
        .sign(jwtSecret());

      return { token, expiresInSeconds: 60 };
    },
  );
}
