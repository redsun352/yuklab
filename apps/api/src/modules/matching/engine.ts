import type { PrismaClient } from "@yuklab/database";
import { findNearbyDriverIds, getDriverLocation } from "../tracking/state";
import { getRoutingProvider } from "../routing/provider";

type MatchCandidate = {
  providerId: string;
  score: number;
  distanceKm: number;
  rating: number;
  reliabilityScore: number;
  etaMinutes: number | null;
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function findMatches(prisma: PrismaClient, orderId: string): Promise<MatchCandidate[]> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.pickupLat === null || order.pickupLng === null) return [];

  const pickupLat = Number(order.pickupLat);
  const pickupLng = Number(order.pickupLng);
  const maxRadiusKm = Number(process.env.MATCHING_MAX_RADIUS_KM ?? 50);
  const nearbyIds = await findNearbyDriverIds(pickupLat, pickupLng, maxRadiusKm);
  if (nearbyIds.length === 0) return [];

  const providers = await prisma.driverProfile.findMany({
    where: {
      userId: { in: nearbyIds },
      isOnline: true,
      isAvailable: true,
      user: { status: "ACTIVE" },
    },
    include: { user: { select: { id: true } } },
  });

  const routing = getRoutingProvider();
  const candidates: MatchCandidate[] = [];
  for (const provider of providers) {
    const location = await getDriverLocation(provider.user.id);
    if (!location) continue;

    const distanceKm = haversineKm(pickupLat, pickupLng, location.lat, location.lng);
    const route = await routing.route(
      { lat: location.lat, lng: location.lng },
      { lat: pickupLat, lng: pickupLng },
    );
    const etaMinutes = route ? Math.max(1, Math.ceil(route.durationSeconds / 60)) : null;
    const distanceScore = Math.max(0, 40 - Math.min(distanceKm, 40));
    const ratingScore = Number(provider.rating) * 6;
    const reliabilityScore = Number(provider.reliabilityScore) * 0.2;
    const etaScore = etaMinutes === null ? 0 : Math.max(0, 20 - Math.min(etaMinutes, 20));
    const score = distanceScore + ratingScore + reliabilityScore + etaScore;

    candidates.push({
      providerId: provider.user.id,
      score,
      distanceKm,
      rating: Number(provider.rating),
      reliabilityScore: Number(provider.reliabilityScore),
      etaMinutes,
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}
