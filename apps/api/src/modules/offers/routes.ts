import type { FastifyInstance } from "fastify";
import type { Prisma } from "@yuklab/database";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../auth/guard";

function serializeBigInt<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v))) as T;
}

export async function offerRoutes(app: FastifyInstance) {
  app.post<{
    Params: { orderId: string };
    Body: { amountMinor: string | number; currency?: string; etaMinutes?: number; note?: string; expiresAt?: string };
  }>(
    "/v1/orders/:orderId/offers",
    { preHandler: requireRole("DRIVER", "SERVICE_PROVIDER") },
    async (request, reply) => {
      const order = await prisma.order.findUnique({ where: { id: request.params.orderId } });
      if (!order || ["CANCELLED", "EXPIRED", "FAILED", "DISPUTED", "COMPLETED"].includes(order.status)) {
        return reply.code(404).send({ error: "ORDER_NOT_OPEN" });
      }
      const amountMinor = BigInt(request.body.amountMinor);
      if (amountMinor <= 0n) return reply.code(400).send({ error: "INVALID_AMOUNT" });
      const etaMinutes = request.body.etaMinutes === undefined ? undefined : Math.max(1, Math.trunc(request.body.etaMinutes));
      if (request.body.expiresAt && Number.isNaN(Date.parse(request.body.expiresAt))) {
        return reply.code(400).send({ error: "INVALID_EXPIRY" });
      }

      const existing = await prisma.offer.findFirst({
        where: { orderId: order.id, providerId: request.user!.id, status: "PENDING" },
      });
      if (existing) return reply.code(409).send({ error: "PENDING_OFFER_EXISTS" });

      const offer = await prisma.offer.create({
        data: {
          orderId: order.id,
          providerId: request.user!.id,
          amountMinor,
          currency: request.body.currency ?? order.currency,
          etaMinutes,
          note: request.body.note?.trim(),
          expiresAt: request.body.expiresAt ? new Date(request.body.expiresAt) : undefined,
        },
      });
      return reply.code(201).send({ offer: serializeBigInt(offer) });
    },
  );

  app.get<{ Params: { orderId: string } }>(
    "/v1/orders/:orderId/offers",
    { preHandler: requireAuth },
    async (request, reply) => {
      const order = await prisma.order.findFirst({ where: { id: request.params.orderId, customerId: request.user!.id } });
      if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      const offers = await prisma.offer.findMany({
        where: { orderId: order.id },
        orderBy: [{ status: "asc" }, { amountMinor: "asc" }],
        include: { provider: { select: { id: true, firstName: true, lastName: true, role: true } } },
      });
      return { offers: serializeBigInt(offers) };
    },
  );

  app.post<{ Params: { orderId: string; offerId: string } }>(
    "/v1/orders/:orderId/offers/:offerId/accept",
    { preHandler: requireAuth },
    async (request, reply) => {
      const order = await prisma.order.findFirst({ where: { id: request.params.orderId, customerId: request.user!.id } });
      if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      if (!["PUBLISHED", "OFFERING"].includes(order.status)) return reply.code(409).send({ error: "ORDER_NOT_ACCEPTING_OFFERS" });

      const offer = await prisma.offer.findFirst({ where: { id: request.params.offerId, orderId: order.id, status: "PENDING" } });
      if (!offer) return reply.code(404).send({ error: "OFFER_NOT_FOUND" });
      if (offer.expiresAt && offer.expiresAt <= new Date()) return reply.code(410).send({ error: "OFFER_EXPIRED" });

      const accepted = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.offer.updateMany({ where: { orderId: order.id, status: "PENDING" }, data: { status: "REJECTED" } });
        const selected = await tx.offer.update({ where: { id: offer.id }, data: { status: "ACCEPTED" } });
        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: { status: "DRIVER_ASSIGNED", assignedDriverId: offer.providerId },
        });
        return { selected, updatedOrder };
      });

      return {
        order: serializeBigInt(accepted.updatedOrder),
        offer: serializeBigInt(accepted.selected),
      };
    },
  );
}
