import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../auth/guard";
import { findMatches } from "./engine";

export async function matchingRoutes(app: FastifyInstance) {
  app.get<{ Params: { orderId: string } }>(
    "/v1/orders/:orderId/matches",
    { preHandler: requireAuth },
    async (request, reply) => {
      const order = await prisma.order.findFirst({
        where: { id: request.params.orderId, customerId: request.user!.id },
        select: { id: true },
      });
      if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });

      const matches = await findMatches(prisma, order.id);
      return { matches };
    },
  );
}
