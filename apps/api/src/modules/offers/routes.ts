import type { FastifyInstance } from "fastify";
import type { Prisma } from "@yuklab/database";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../auth/guard";
import { findMatches } from "../matching/engine";
import { publishOrderOffer, publishOrderStatus } from "../tracking/realtime";

const CURRENCY_RE = /^[A-Z]{3}$/;
const MAX_ETA_MINUTES = 7 * 24 * 60;
const MAX_NOTE_LENGTH = 1000;
const MAX_OFFER_AMOUNT_MINOR = 9223372036854775807n;
const ACTIVE_ASSIGNMENT_STATUSES = [
  "DRIVER_ASSIGNED",
  "EN_ROUTE_PICKUP",
  "ARRIVED_PICKUP",
  "LOADED",
  "IN_TRANSIT",
  "ARRIVED_DELIVERY",
  "DELIVERED",
] as const;
const OPEN_ORDER_STATUSES = ["PUBLISHED", "OFFERING"] as const;

function serializeBigInt<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v))) as T;
}

export async function offerRoutes(app: FastifyInstance) {
  app.post<{
    Params: { orderId: string };
    Body: { amountMinor: string | number; currency?: string; etaMinutes?: number; note?: string; expiresAt?: string };
  }>("/v1/orders/:orderId/offers", { preHandler: requireRole("DRIVER", "SERVICE_PROVIDER") }, async (req, reply) => {
    const order = await prisma.order.findUnique({ where: { id: req.params.orderId } });
    if (!order || !OPEN_ORDER_STATUSES.includes(order.status as typeof OPEN_ORDER_STATUSES[number])) return reply.code(404).send({ error: "ORDER_NOT_OPEN" });

    const matches = await findMatches(prisma, order.id);
    const eligible = matches.find((candidate) => candidate.providerId === req.user!.id);
    if (!eligible) return reply.code(403).send({ error: "PROVIDER_NOT_MATCHED" });

    let amountMinor: bigint;
    try {
      if (req.body.amountMinor === undefined || (typeof req.body.amountMinor === "number" && !Number.isSafeInteger(req.body.amountMinor))) throw new Error();
      amountMinor = BigInt(req.body.amountMinor);
    } catch {
      return reply.code(400).send({ error: "INVALID_AMOUNT" });
    }
    if (amountMinor <= 0n || amountMinor > MAX_OFFER_AMOUNT_MINOR) return reply.code(400).send({ error: "INVALID_AMOUNT" });

    const currency = (req.body.currency ?? order.currency).trim().toUpperCase();
    if (!CURRENCY_RE.test(currency)) return reply.code(400).send({ error: "INVALID_CURRENCY" });
    if (currency !== order.currency) return reply.code(400).send({ error: "CURRENCY_MISMATCH" });

    let etaMinutes: number | undefined;
    if (req.body.etaMinutes !== undefined) {
      if (!Number.isFinite(req.body.etaMinutes) || !Number.isInteger(req.body.etaMinutes) || req.body.etaMinutes < 1 || req.body.etaMinutes > MAX_ETA_MINUTES) return reply.code(400).send({ error: "INVALID_ETA" });
      etaMinutes = req.body.etaMinutes;
    }

    const note = req.body.note?.trim();
    if (note && note.length > MAX_NOTE_LENGTH) return reply.code(400).send({ error: "NOTE_TOO_LONG" });

    let expiresAt: Date | undefined;
    if (req.body.expiresAt) {
      const parsed = new Date(req.body.expiresAt);
      if (Number.isNaN(parsed.getTime()) || parsed <= new Date()) return reply.code(400).send({ error: "INVALID_EXPIRY" });
      expiresAt = parsed;
    }

    const existing = await prisma.offer.findFirst({ where: { orderId: order.id, providerId: req.user!.id, status: "PENDING" } });
    if (existing) return reply.code(409).send({ error: "PENDING_OFFER_EXISTS" });

    try {
      const created = await prisma.$transaction(async (tx) => {
        const offer = await tx.offer.create({ data: { orderId: order.id, providerId: req.user!.id, amountMinor, currency, etaMinutes, note, expiresAt } });
        if (order.status === "PUBLISHED") await tx.order.update({ where: { id: order.id }, data: { status: "OFFERING" } });
        return offer;
      });

      publishOrderOffer(order.id, created);
      if (order.status === "PUBLISHED") publishOrderStatus(order.id, "PUBLISHED", "OFFERING");
      return reply.code(201).send({ offer: serializeBigInt(created) });
    } catch (error: unknown) {
      if (error instanceof Error && (error.message.includes("Unique constraint") || error.message.includes("P2002"))) return reply.code(409).send({ error: "PENDING_OFFER_EXISTS" });
      throw error;
    }
  });

  app.get<{ Params: { orderId: string } }>("/v1/orders/:orderId/offers", { preHandler: requireAuth }, async (req, reply) => {
    const order = await prisma.order.findFirst({ where: { id: req.params.orderId, customerId: req.user!.id } });
    if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    const offers = await prisma.offer.findMany({ where: { orderId: order.id }, orderBy: [{ status: "asc" }, { amountMinor: "asc" }], include: { provider: { select: { id: true, firstName: true, lastName: true, role: true } } } });
    return { offers: serializeBigInt(offers) };
  });

  app.get("/v1/provider/offers", { preHandler: requireRole("DRIVER", "SERVICE_PROVIDER") }, async (req) => {
    const offers = await prisma.offer.findMany({
      where: { providerId: req.user!.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { order: { select: { id: true, serviceType: true, status: true, pickupAddress: true, deliveryAddress: true, pickupLat: true, pickupLng: true, deliveryLat: true, deliveryLng: true, scheduledAt: true, budgetMinor: true, currency: true, urgency: true, createdAt: true } } },
    });
    return { offers: serializeBigInt(offers) };
  });

  app.post<{ Params: { offerId: string } }>("/v1/provider/offers/:offerId/withdraw", { preHandler: requireRole("DRIVER", "SERVICE_PROVIDER") }, async (req, reply) => {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const offer = await tx.offer.findFirst({ where: { id: req.params.offerId, providerId: req.user!.id, status: "PENDING" }, select: { id: true, orderId: true } });
        if (!offer) throw new Error("OFFER_NOT_PENDING");

        const withdrawn = await tx.offer.updateMany({ where: { id: offer.id, providerId: req.user!.id, status: "PENDING" }, data: { status: "WITHDRAWN" } });
        if (withdrawn.count !== 1) throw new Error("OFFER_NOT_PENDING");

        const order = await tx.order.findUnique({ where: { id: offer.orderId }, select: { id: true, status: true } });
        if (!order) throw new Error("ORDER_NOT_FOUND");

        let reopened = false;
        if (order.status === "OFFERING") {
          const remaining = await tx.offer.count({ where: { orderId: order.id, status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
          if (remaining === 0) {
            const reopenedOrder = await tx.order.updateMany({ where: { id: order.id, status: "OFFERING" }, data: { status: "PUBLISHED" } });
            reopened = reopenedOrder.count === 1;
          }
        }

        await tx.trackingEvent.create({ data: { orderId: order.id, actorId: req.user!.id, eventType: "OFFER_WITHDRAWN", metadata: { offerId: offer.id, providerId: req.user!.id, reopened } } });
        await tx.auditLog.create({ data: { actorId: req.user!.id, action: "OFFER_WITHDRAWN", entityType: "Offer", entityId: offer.id, metadata: { orderId: order.id, reopened } } });
        return { offerId: offer.id, orderId: order.id, previousStatus: order.status, reopened };
      });

      if (result.reopened) publishOrderStatus(result.orderId, "OFFERING", "PUBLISHED");
      return { offer: { id: result.offerId, status: "WITHDRAWN" }, order: { id: result.orderId, status: result.reopened ? "PUBLISHED" : result.previousStatus } };
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "OFFER_NOT_PENDING") return reply.code(409).send({ error: "OFFER_NOT_PENDING" });
      if (error instanceof Error && error.message === "ORDER_NOT_FOUND") return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      throw error;
    }
  });

  app.post<{ Params: { orderId: string; offerId: string } }>("/v1/orders/:orderId/offers/:offerId/accept", { preHandler: requireAuth }, async (req, reply) => {
    const order = await prisma.order.findFirst({ where: { id: req.params.orderId, customerId: req.user!.id }, select: { id: true, status: true } });
    if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    if (!OPEN_ORDER_STATUSES.includes(order.status as typeof OPEN_ORDER_STATUSES[number])) return reply.code(409).send({ error: "ORDER_NOT_ACCEPTING_OFFERS" });

    const selectedBeforeClaim = await prisma.offer.findFirst({
      where: { id: req.params.offerId, orderId: order.id, status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { id: true, providerId: true },
    });
    if (!selectedBeforeClaim) return reply.code(410).send({ error: "OFFER_EXPIRED_OR_NOT_FOUND" });

    const match = (await findMatches(prisma, order.id)).find((candidate) => candidate.providerId === selectedBeforeClaim.providerId);
    if (!match) return reply.code(409).send({ error: "OFFER_NO_LONGER_ELIGIBLE" });

    try {
      const accepted = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", `yuklab:provider:${selectedBeforeClaim.providerId}`);

        const provider = await tx.user.findFirst({ where: { id: selectedBeforeClaim.providerId, status: "ACTIVE", role: { in: ["DRIVER", "SERVICE_PROVIDER"] }, OR: [{ driverProfile: { is: { isOnline: true, isAvailable: true } } }, { serviceProvider: { is: { isOnline: true, isAvailable: true } } }] }, select: { id: true } });
        if (!provider) throw new Error("OFFER_NO_LONGER_ELIGIBLE");

        const activeProviderOrder = await tx.order.findFirst({ where: { assignedDriverId: selectedBeforeClaim.providerId, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } }, select: { id: true } });
        if (activeProviderOrder) throw new Error("PROVIDER_NO_LONGER_AVAILABLE");

        if (match.vehicleId) {
          await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", `yuklab:vehicle:${match.vehicleId}`);
          const vehicle = await tx.vehicle.findFirst({ where: { id: match.vehicleId, ownerId: selectedBeforeClaim.providerId, active: true }, select: { id: true } });
          if (!vehicle) throw new Error("VEHICLE_NO_LONGER_AVAILABLE");
          const activeVehicleOrder = await tx.order.findFirst({ where: { vehicleId: match.vehicleId, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } }, select: { id: true } });
          if (activeVehicleOrder) throw new Error("VEHICLE_NO_LONGER_AVAILABLE");
        }

        const claimed = await tx.order.updateMany({ where: { id: order.id, customerId: req.user!.id, status: { in: [...OPEN_ORDER_STATUSES] } }, data: { status: "DRIVER_ASSIGNED", assignedDriverId: selectedBeforeClaim.providerId, vehicleId: match.vehicleId } });
        if (claimed.count !== 1) throw new Error("ORDER_ALREADY_ASSIGNED");

        const selected = await tx.offer.findFirst({ where: { id: req.params.offerId, orderId: order.id, status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
        if (!selected) throw new Error("OFFER_NOT_FOUND_OR_EXPIRED");
        await tx.offer.updateMany({ where: { orderId: order.id, status: "PENDING", id: { not: selected.id } }, data: { status: "REJECTED" } });
        const acceptedOffer = await tx.offer.update({ where: { id: selected.id }, data: { status: "ACCEPTED" } });

        await tx.trackingEvent.create({ data: { orderId: order.id, actorId: req.user!.id, eventType: "OFFER_ACCEPTED", metadata: { offerId: selected.id, providerId: selected.providerId, vehicleId: match.vehicleId } } });
        await tx.auditLog.create({ data: { actorId: req.user!.id, action: "OFFER_ACCEPTED", entityType: "Offer", entityId: selected.id, metadata: { orderId: order.id, providerId: selected.providerId, vehicleId: match.vehicleId } } });

        const updatedOrder = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        return { selected: acceptedOffer, updatedOrder };
      });
      publishOrderStatus(order.id, order.status, "DRIVER_ASSIGNED");
      return { order: serializeBigInt(accepted.updatedOrder), offer: serializeBigInt(accepted.selected) };
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "ORDER_ALREADY_ASSIGNED") return reply.code(409).send({ error: "ORDER_NOT_ACCEPTING_OFFERS" });
      if (error instanceof Error && error.message === "OFFER_NOT_FOUND_OR_EXPIRED") return reply.code(410).send({ error: "OFFER_EXPIRED_OR_NOT_FOUND" });
      if (error instanceof Error && error.message === "OFFER_NO_LONGER_ELIGIBLE") return reply.code(409).send({ error: "OFFER_NO_LONGER_ELIGIBLE" });
      if (error instanceof Error && error.message === "PROVIDER_NO_LONGER_AVAILABLE") return reply.code(409).send({ error: "PROVIDER_NO_LONGER_AVAILABLE" });
      if (error instanceof Error && error.message === "VEHICLE_NO_LONGER_AVAILABLE") return reply.code(409).send({ error: "VEHICLE_NO_LONGER_AVAILABLE" });
      throw error;
    }
  });
}
