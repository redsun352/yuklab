import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import { requireRole } from "../auth/guard";

function serializeBigInt<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v))) as T;
}

export async function providerOrderRoutes(app: FastifyInstance) {
  app.get("/v1/provider/orders", { preHandler: requireRole("DRIVER", "SERVICE_PROVIDER") }, async (request) => {
    const orders = await prisma.order.findMany({
      where: { status: { in: ["PUBLISHED", "OFFERING"] }, offers: { none: { providerId: request.user!.id, status: "PENDING" } } },
      orderBy: [{ urgency: "desc" }, { createdAt: "asc" }],
      take: 50,
      select: { id: true, serviceType: true, status: true, pickupAddress: true, deliveryAddress: true, pickupLat: true, pickupLng: true, deliveryLat: true, deliveryLng: true, scheduledAt: true, budgetMinor: true, currency: true, urgency: true, createdAt: true },
    });
    return { orders: serializeBigInt(orders) };
  });

  app.get("/v1/provider/offers", { preHandler: requireRole("DRIVER", "SERVICE_PROVIDER") }, async (request) => {
    const offers = await prisma.offer.findMany({
      where: { providerId: request.user!.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { order: { select: { id: true, serviceType: true, status: true, pickupAddress: true, deliveryAddress: true } } },
    });
    return { offers: serializeBigInt(offers) };
  });
}
