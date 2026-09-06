import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../auth/guard";
import { findMatches } from "./engine";

const OPEN_ORDER_STATUSES = ["PUBLISHED", "OFFERING"] as const;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

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

  app.get<{ Querystring: { limit?: string } }>(
    "/v1/provider/matches",
    { preHandler: requireRole("DRIVER", "SERVICE_PROVIDER") },
    async (request) => {
      const parsedLimit = Number(request.query.limit ?? DEFAULT_LIMIT);
      const limit = Number.isInteger(parsedLimit) ? Math.min(MAX_LIMIT, Math.max(1, parsedLimit)) : DEFAULT_LIMIT;

      const orders = await prisma.order.findMany({
        where: { status: { in: [...OPEN_ORDER_STATUSES] }, pickupLat: { not: null }, pickupLng: { not: null } },
        orderBy: [{ urgency: "desc" }, { createdAt: "asc" }],
        take: MAX_LIMIT * 4,
        select: {
          id: true,
          serviceType: true,
          status: true,
          pickupAddress: true,
          deliveryAddress: true,
          pickupLat: true,
          pickupLng: true,
          deliveryLat: true,
          deliveryLng: true,
          scheduledAt: true,
          budgetMinor: true,
          currency: true,
          urgency: true,
          payload: true,
          createdAt: true,
        },
      });

      const opportunities: Array<{ order: typeof orders[number]; match: Awaited<ReturnType<typeof findMatches>>[number] }> = [];
      for (const order of orders) {
        const match = (await findMatches(prisma, order.id)).find((candidate) => candidate.providerId === request.user!.id);
        if (!match) continue;
        opportunities.push({ order, match });
        if (opportunities.length >= limit) break;
      }

      return {
        opportunities: opportunities.map(({ order, match }) => ({
          order: {
            ...order,
            budgetMinor: order.budgetMinor?.toString() ?? null,
          },
          match,
        })),
      };
    },
  );
}
