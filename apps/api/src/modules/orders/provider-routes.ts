import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/guard";
import { findMatches } from "../matching/engine";
import { prisma } from "../../lib/prisma";

function serializeBigInt<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v))) as T;
}

const ACTIVE_ASSIGNED_STATUSES = [
  "DRIVER_ASSIGNED",
  "EN_ROUTE_PICKUP",
  "ARRIVED_PICKUP",
  "LOADED",
  "IN_TRANSIT",
  "ARRIVED_DELIVERY",
  "DELIVERED",
] as const;

export async function providerOrderRoutes(app: FastifyInstance) {
  app.get("/v1/provider/orders", { preHandler: requireRole("DRIVER", "SERVICE_PROVIDER") }, async (request) => {
    const orders = await prisma.order.findMany({
      where: {
        OR: [
          {
            status: { in: ["PUBLISHED", "OFFERING"] },
            offers: { none: { providerId: request.user!.id, status: "PENDING" } },
          },
          {
            assignedDriverId: request.user!.id,
            status: { in: [...ACTIVE_ASSIGNED_STATUSES] },
          },
        ],
      },
      orderBy: [{ urgency: "desc" }, { createdAt: "asc" }],
      take: 200,
      select: {
        id: true,
        assignedDriverId: true,
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

    const matched = await Promise.all(
      orders.map(async (order) => {
        if (order.assignedDriverId === request.user!.id) return { order, match: null };
        if (order.status !== "PUBLISHED" && order.status !== "OFFERING") return null;
        const candidates = await findMatches(prisma, order.id);
        const match = candidates.find((candidate) => candidate.providerId === request.user!.id);
        return match ? { order, match } : null;
      }),
    );

    const visibleOrders = matched
      .filter((item): item is { order: (typeof orders)[number]; match: Awaited<ReturnType<typeof findMatches>>[number] | null } => item !== null)
      .sort((a, b) => {
        if (a.order.assignedDriverId === request.user!.id) return -1;
        if (b.order.assignedDriverId === request.user!.id) return 1;
        if (b.order.urgency !== a.order.urgency) return b.order.urgency - a.order.urgency;
        return (b.match?.score ?? 0) - (a.match?.score ?? 0);
      })
      .slice(0, 50)
      .map(({ order, match }) => match ? { ...order, match } : order);

    return { orders: serializeBigInt(visibleOrders) };
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
