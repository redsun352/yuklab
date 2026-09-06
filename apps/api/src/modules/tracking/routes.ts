import type { FastifyInstance } from "fastify";
import { OrderStatus } from "@yuklab/database";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../auth/guard";
import { getDriverLocation, setDriverLocation } from "./state";
import { publishOrderLocation } from "./realtime";
import { DELIVERY_PROOF_TYPES, submitDeliveryProof } from "../orders/delivery-proof";

const MAX_LOCATION_AGE_MS = 5 * 60 * 1000;
const MAX_LOCATION_FUTURE_MS = 60 * 1000;
const MAX_HISTORY_LIMIT = 500;
const TERMINAL_ORDER_STATUSES: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.EXPIRED, OrderStatus.FAILED, OrderStatus.COMPLETED, OrderStatus.DISPUTED];

export async function trackingRoutes(app: FastifyInstance) {
  app.post<{ Body: { lat: number; lng: number; heading?: number; speedKph?: number; accuracyM?: number; timestamp?: string; orderId?: string } }>("/v1/tracking/location", { preHandler: requireRole("DRIVER", "SERVICE_PROVIDER") }, async (request, reply) => {
    const { lat, lng, heading, speedKph, accuracyM, timestamp, orderId } = request.body;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return reply.code(400).send({ error: "INVALID_LOCATION" });
    if (heading !== undefined && (!Number.isFinite(heading) || heading < 0 || heading >= 360)) return reply.code(400).send({ error: "INVALID_HEADING" });
    if (speedKph !== undefined && (!Number.isFinite(speedKph) || speedKph < 0 || speedKph > 500)) return reply.code(400).send({ error: "INVALID_SPEED" });
    if (accuracyM !== undefined && (!Number.isFinite(accuracyM) || accuracyM < 0 || accuracyM > 10000)) return reply.code(400).send({ error: "INVALID_ACCURACY" });
    const time = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(time.getTime())) return reply.code(400).send({ error: "INVALID_TIMESTAMP" });
    const now = Date.now();
    if (time.getTime() < now - MAX_LOCATION_AGE_MS || time.getTime() > now + MAX_LOCATION_FUTURE_MS) return reply.code(400).send({ error: "TIMESTAMP_OUT_OF_RANGE" });
    if (orderId) {
      const order = await prisma.order.findFirst({ where: { id: orderId, assignedDriverId: request.user!.id, status: { notIn: TERMINAL_ORDER_STATUSES } }, select: { id: true } });
      if (!order) return reply.code(403).send({ error: "ORDER_NOT_ASSIGNED" });
    }
    const location = { driverId: request.user!.id, lat, lng, heading, speedKph, accuracyM, timestamp: time.toISOString() };
    const shouldPersist = await setDriverLocation(location);
    if (orderId) {
      publishOrderLocation(orderId, location);
      if (shouldPersist) await prisma.trackingEvent.create({ data: { orderId, actorId: request.user!.id, eventType: "DRIVER_LOCATION", lat, lng, metadata: { heading, speedKph, accuracyM, timestamp: time.toISOString() } } });
    }
    return reply.code(204).send();
  });

  app.post<{ Params: { orderId: string }; Body: { type: string; fileUrl?: string; recipientName?: string; note?: string } }>("/v1/tracking/orders/:orderId/delivery-proof", { preHandler: requireRole("DRIVER", "SERVICE_PROVIDER") }, async (request, reply) => {
    const { type, fileUrl, recipientName, note } = request.body ?? {};
    if (!DELIVERY_PROOF_TYPES.includes(type as (typeof DELIVERY_PROOF_TYPES)[number])) return reply.code(400).send({ error: "INVALID_PROOF_TYPE" });
    try {
      const event = await submitDeliveryProof(prisma, { orderId: request.params.orderId, actorId: request.user!.id, type: type as (typeof DELIVERY_PROOF_TYPES)[number], fileUrl, recipientName, note });
      return reply.code(201).send({ proof: event });
    } catch (error) {
      const code = error instanceof Error ? error.message : "DELIVERY_PROOF_FAILED";
      if (["ORDER_NOT_FOUND", "NOT_ASSIGNED_PROVIDER", "INVALID_PROOF_STATE", "PROOF_DATA_REQUIRED"].includes(code)) {
        const statusCode = code === "ORDER_NOT_FOUND" ? 404 : code === "PROOF_DATA_REQUIRED" ? 400 : 409;
        return reply.code(statusCode).send({ error: code });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "DELIVERY_PROOF_FAILED" });
    }
  });

  app.get<{ Params: { driverId: string } }>("/v1/tracking/drivers/:driverId/location", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
    if (!isAdmin && user.id !== request.params.driverId) {
      const relatedOrder = await prisma.order.findFirst({ where: { assignedDriverId: request.params.driverId, customerId: user.id, status: { notIn: [OrderStatus.DRAFT, ...TERMINAL_ORDER_STATUSES] } }, select: { id: true } });
      if (!relatedOrder) return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const location = await getDriverLocation(request.params.driverId);
    if (!location) return reply.code(404).send({ error: "LOCATION_NOT_AVAILABLE" });
    return { location };
  });

  app.get<{ Params: { orderId: string }; Querystring: { limit?: string; before?: string } }>("/v1/tracking/orders/:orderId/history", { preHandler: requireAuth }, async (request, reply) => {
    const order = await prisma.order.findFirst({ where: { id: request.params.orderId, OR: [{ customerId: request.user!.id }, { assignedDriverId: request.user!.id }] }, select: { id: true } });
    if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    const requestedLimit = request.query.limit === undefined ? 100 : Number(request.query.limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_HISTORY_LIMIT) return reply.code(400).send({ error: "INVALID_LIMIT" });
    const before = request.query.before ? new Date(request.query.before) : undefined;
    if (before && Number.isNaN(before.getTime())) return reply.code(400).send({ error: "INVALID_BEFORE" });
    const events = await prisma.trackingEvent.findMany({ where: { orderId: order.id, ...(before ? { createdAt: { lt: before } } : {}) }, orderBy: { createdAt: "desc" }, take: requestedLimit, select: { id: true, actorId: true, eventType: true, lat: true, lng: true, etaSeconds: true, metadata: true, createdAt: true } });
    return { events, nextBefore: events.length === requestedLimit ? events[events.length - 1]?.createdAt ?? null : null };
  });

  app.get<{ Params: { orderId: string } }>("/v1/tracking/orders/:orderId/location", { preHandler: requireAuth }, async (request, reply) => {
    const order = await prisma.order.findFirst({ where: { id: request.params.orderId, OR: [{ customerId: request.user!.id }, { assignedDriverId: request.user!.id }] }, select: { id: true, assignedDriverId: true, status: true, pickupAddress: true, deliveryAddress: true, pickupLat: true, pickupLng: true, deliveryLat: true, deliveryLng: true } });
    if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    if (TERMINAL_ORDER_STATUSES.includes(order.status)) return reply.code(409).send({ error: "TRACKING_NOT_ACTIVE" });
    if (!order.assignedDriverId) return reply.code(404).send({ error: "DRIVER_NOT_ASSIGNED" });
    const location = await getDriverLocation(order.assignedDriverId);
    if (!location) return reply.code(404).send({ error: "LOCATION_NOT_AVAILABLE" });
    return { location, order: { id: order.id, status: order.status, pickupAddress: order.pickupAddress, deliveryAddress: order.deliveryAddress, pickupLat: order.pickupLat, pickupLng: order.pickupLng, deliveryLat: order.deliveryLat, deliveryLng: order.deliveryLng } };
  });
}
