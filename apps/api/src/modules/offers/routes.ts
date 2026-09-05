import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import { requireRole } from "../auth/guard";
import { findMatches } from "../matching/engine";

export async function offerRoutes(app: FastifyInstance) {
  app.post("/v1/orders/:orderId/offers", { preHandler: requireRole("DRIVER", "SERVICE_PROVIDER") }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const amountMinor = Number(body.amountMinor);
    const etaMinutes = body.etaMinutes === undefined ? undefined : Number(body.etaMinutes);
    const note = body.note === undefined ? undefined : String(body.note).trim();

    if (!Number.isInteger(amountMinor) || amountMinor <= 0) return reply.code(400).send({ error: "INVALID_AMOUNT" });
    if (etaMinutes !== undefined && (!Number.isInteger(etaMinutes) || etaMinutes <= 0)) return reply.code(400).send({ error: "INVALID_ETA" });

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    if (order.status !== "PUBLISHED" && order.status !== "OFFERING") return reply.code(409).send({ error: "ORDER_NOT_OFFERABLE" });

    const matches = await findMatches(prisma, orderId);
    const match = matches.find((candidate) => candidate.providerId === request.user!.id);
    if (!match) return reply.code(403).send({ error: "PROVIDER_NOT_ELIGIBLE" });

    const offer = await prisma.offer.create({
      data: { orderId, providerId: request.user!.id, amountMinor: BigInt(amountMinor), currency: order.currency, etaMinutes, note: note || undefined },
    });
    if (order.status === "PUBLISHED") await prisma.order.update({ where: { id: orderId }, data: { status: "OFFERING" } });

    return { offer: { ...offer, amountMinor: offer.amountMinor.toString() } };
  });
}
