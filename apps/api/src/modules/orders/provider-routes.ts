import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/guard";
import { findMatches } from "../matching/engine";
import { prisma } from "../../lib/prisma";
import { publishOrderStatus } from "../tracking/realtime";

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

  app.post<{ Params: { offerId: string } }>("/v1/provider/offers/:offerId/withdraw", { preHandler: requireRole("DRIVER", "SERVICE_PROVIDER") }, async (request, reply) => {
    const existing = await prisma.offer.findFirst({
      where: { id: request.params.offerId, providerId: request.user!.id },
      select: { id: true, orderId: true, status: true },
    });
    if (!existing) return reply.code(404).send({ error: "OFFER_NOT_FOUND" });
    if (existing.status !== "PENDING") return reply.code(409).send({ error: "OFFER_NOT_PENDING" });

    try {
      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.offer.updateMany({
          where: { id: existing.id, providerId: request.user!.id, status: "PENDING" },
          data: { status: "WITHDRAWN" },
        });
        if (claimed.count !== 1) throw new Error("OFFER_NOT_PENDING");

        const order = await tx.order.findUnique({ where: { id: existing.orderId }, select: { id: true, status: true } });
        if (!order) throw new Error("ORDER_NOT_FOUND");

        let reopened = false;
        if (order.status === "OFFERING") {
          const pendingCount = await tx.offer.count({
            where: {
              orderId: order.id,
              status: "PENDING",
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
          });
          if (pendingCount === 0) {
            const reopenedOrder = await tx.order.updateMany({ where: { id: order.id, status: "OFFERING" }, data: { status: "PUBLISHED" } });
            reopened = reopenedOrder.count === 1;
          }
        }

        await tx.trackingEvent.create({
          data: {
            orderId: order.id,
            actorId: request.user!.id,
            eventType: "OFFER_WITHDRAWN",
            metadata: { offerId: existing.id, providerId: request.user!.id, reopened },
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: request.user!.id,
            action: "OFFER_WITHDRAWN",
            entityType: "Offer",
            entityId: existing.id,
            metadata: { orderId: order.id, providerId: request.user!.id, reopened },
          },
        });

        const offer = await tx.offer.findUniqueOrThrow({ where: { id: existing.id } });
        const updatedOrder = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { id: true, status: true } });
        return { offer, order: updatedOrder, previousOrderStatus: order.status, reopened };
      });

      if (result.reopened) publishOrderStatus(result.order.id, result.previousOrderStatus, "PUBLISHED");
      return { offer: serializeBigInt(result.offer), order: result.order };
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "OFFER_NOT_PENDING") return reply.code(409).send({ error: "OFFER_NOT_PENDING" });
      if (error instanceof Error && error.message === "ORDER_NOT_FOUND") return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      throw error;
    }
  });
}
