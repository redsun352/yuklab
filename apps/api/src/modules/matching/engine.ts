import type { PrismaClient } from "@yuklab/database";

type MatchCandidate = {
  providerId: string;
  score: number;
  distanceKm: number;
  rating: number;
  reliabilityScore: number;
  etaMinutes: number;
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
  if (!order) return [];
  if (order.pickupLat === null || order.pickupLng === null) return [];

  const pickupLat = Number(order.pickupLat);
  const pickupLng = Number(order.pickupLng);
  const providers = await prisma.driverProfile.findMany({
    where: { isOnline: true, isAvailable: true, user: { status: "ACTIVE" } },
    include: { user: { select: { id: true } } },
  });

  return providers
    .map((provider) => {
      // Driver GPS positions will become the source of truth once TrackingState is introduced.
      // For now, keep the provider eligible and let downstream availability/ETA enrich this score.
      const distanceKm = Number(provider.serviceRadiusKm);
      const distanceScore = Math.max(0, 40 - Math.min(distanceKm, 40));
      const ratingScore = Number(provider.rating) * 6;
      const reliabilityScore = Number(provider.reliabilityScore) * 0.2;
      const availabilityScore = provider.isAvailable ? 20 : 0;
      const score = distanceScore + ratingScore + reliabilityScore + availabilityScore;
      const etaMinutes = Math.max(5, Math.round(distanceKm * 3));
      return {
        providerId: provider.user.id,
        score,
        distanceKm,
        rating: Number(provider.rating),
        reliabilityScore: Number(provider.reliabilityScore),
        etaMinutes,
      };
    })
    .sort((a, b) => b.score - a.score);
}
