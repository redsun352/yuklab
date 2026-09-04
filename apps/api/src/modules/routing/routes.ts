import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/guard";
import { getRoutingProvider, type RoutePoint } from "./provider";

function validPoint(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function haversineMeters(from: RoutePoint, to: RoutePoint): number {
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(to.lat - from.lat);
  const dLng = rad(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function routingRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { fromLat?: string; fromLng?: string; toLat?: string; toLng?: string } }>(
    "/v1/routing/route",
    { preHandler: requireAuth },
    async (request, reply) => {
      const from = { lat: Number(request.query.fromLat), lng: Number(request.query.fromLng) };
      const to = { lat: Number(request.query.toLat), lng: Number(request.query.toLng) };
      if (!validPoint(from.lat, from.lng) || !validPoint(to.lat, to.lng)) return reply.code(400).send({ error: "INVALID_ROUTE_POINTS" });

      const providerResult = await getRoutingProvider().route(from, to);
      if (providerResult) return { ...providerResult, source: "provider" as const };

      const distanceMeters = haversineMeters(from, to);
      const configuredSpeed = Number(process.env.ROUTING_FALLBACK_SPEED_KPH ?? 50);
      const averageSpeedKph = Number.isFinite(configuredSpeed) && configuredSpeed > 0 ? Math.min(configuredSpeed, 200) : 50;
      const speedMps = averageSpeedKph / 3.6;
      return {
        distanceMeters: Math.round(distanceMeters),
        durationSeconds: Math.max(1, Math.round(distanceMeters / speedMps)),
        source: "fallback" as const,
        geometry: [from, to],
      };
    },
  );
}
