import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../auth/guard";
import { getDriverLocation, setDriverLocation } from "./state";
import { publishOrderLocation } from "./realtime";

export async function trackingRoutes(app: FastifyInstance) {
  app.post<{
    Body: { lat: number; lng: number; heading?: number; speedKph?: number; accuracyM?: number; timestamp?: string; orderId?: string };
  }>("/v1/tracking/location", { preHandler: requireRole("DRIVER", "SERVICE_PROVIDER") }, async (request, reply) => {
    const { lat, lng, heading, speedKph, accuracyM, timestamp, orderId } = request.body;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return reply.code(400).send({ error: "INVALID_LOCATION" });
    if (heading !== undefined && (!Number.isFinite(heading) || heading < 0 || heading >= 360)) return reply.code(400).send({ error: "INVALID_HEADING" });
    if (speedKph !== undefined && (!Number.isFinite(speedKph) || speedKph < 0 || speedKph > 500)) return reply.code(400).send({ error: "INVALID_SPEED" });
    if (accuracyM !== undefined && (!Number.isFinite(accuracyM) || accuracyM < 0)) return reply.code(400).send({ error: "INVALID_ACCURACY" });
    const time = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(time.getTime())) return reply.code(400).send({ error: "INVALID_TIMESTAMP" });

    if (orderId) {
      const order = await prisma.order.findFirst({ where: { id: orderId, assignedDriverId: request.user!.id }, select: { id: true } });
      if (!order) return reply.code(403).send({ error: "ORDER_NOT_ASSIGNED" });
    }

    const location = { driverId: request.user!.id, lat, lng, heading, speedKph, accuracyM, timestamp: time.toISOString() };
    await setDriverLocation(location);
    if (orderId) publishOrderLocation(orderId, location);
    return reply.code(204).send();
  });

  app.get<{ Params: { driverId: string } }>("/v1/tracking/drivers/:driverId/location", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
    if (!isAdmin && user.id !== request.params.driverId) {
      const relatedOrder = await prisma.order.findFirst({
        where: {
          assignedDriverId: request.params.driverId,
          customerId: user.id,
          status: { notIn: ["DRAFT", "CANCELLED", "EXPIRED", "FAILED", "COMPLETED"] },
        },
        select: { id: true },
      });
      if (!relatedOrder) return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const location = await getDriverLocation(request.params.driverId);
    if (!location) return reply.code(404).send({ error: "LOCATION_NOT_AVAILABLE" });
    return { location };
  });

  app.get<{ Params: { orderId: string } }>("/v1/tracking/orders/:orderId/location", { preHandler: requireAuth }, async (request, reply) => {
    const order = await prisma.order.findFirst({ where: { id: request.params.orderId, OR: [{ customerId: request.user!.id }, { assignedDriverId: request.user!.id }] }, select: { assignedDriverId: true } });
    if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    if (!order.assignedDriverId) return reply.code(404).send({ error: "DRIVER_NOT_ASSIGNED" });
    const location = await getDriverLocation(order.assignedDriverId);
    if (!location) return reply.code(404).send({ error: "LOCATION_NOT_AVAILABLE" });
    return { location };
  });
}
