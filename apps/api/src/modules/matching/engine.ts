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
  vehicleId: string | null;
  vehicleType: string | null;
  vehicleSubtype: string | null;
  capacityKg: number | null;
  volumeM3: number | null;
  refrigerated: boolean;
};

type OrderRequirements = {
  vehicleTypes: string[];
  vehicleSubtypes: string[];
  minCapacityKg: number | null;
  minVolumeM3: number | null;
  refrigerated: boolean;
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

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function positiveNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function requirementsFromPayload(payload: unknown): OrderRequirements {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { vehicleTypes: [], vehicleSubtypes: [], minCapacityKg: null, minVolumeM3: null, refrigerated: false };
  }

  const data = payload as Record<string, unknown>;
  const vehicle = data.vehicle && typeof data.vehicle === "object" && !Array.isArray(data.vehicle)
    ? data.vehicle as Record<string, unknown>
    : {};
  const load = data.load && typeof data.load === "object" && !Array.isArray(data.load)
    ? data.load as Record<string, unknown>
    : {};

  return {
    vehicleTypes: stringArray(data.vehicleTypes ?? data.requiredVehicleTypes ?? vehicle.types ?? vehicle.type),
    vehicleSubtypes: stringArray(data.vehicleSubtypes ?? data.requiredVehicleSubtypes ?? vehicle.subtypes ?? vehicle.subtype),
    minCapacityKg: positiveNumber(data.weightKg ?? data.loadWeightKg ?? load.weightKg ?? vehicle.minCapacityKg),
    minVolumeM3: positiveNumber(data.volumeM3 ?? data.loadVolumeM3 ?? load.volumeM3 ?? vehicle.minVolumeM3),
    refrigerated: data.refrigerated === true || data.requiresRefrigeration === true || load.refrigerated === true || vehicle.refrigerated === true,
  };
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR");
}

function matchesRequirement(value: string | null | undefined, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  if (!value) return false;
  return allowed.some((item) => normalize(item) === normalize(value));
}

export async function findMatches(prisma: PrismaClient, orderId: string): Promise<MatchCandidate[]> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.pickupLat === null || order.pickupLng === null) return [];

  const requirements = requirementsFromPayload(order.payload);
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
    include: {
      user: {
        select: {
          id: true,
          vehicles: {
            where: { active: true },
            orderBy: { updatedAt: "desc" },
            select: { id: true, type: true, subtype: true, capacityKg: true, volumeM3: true, refrigerated: true },
          },
        },
      },
    },
  });

  const routing = getRoutingProvider();
  const candidates = await Promise.all(
    providers.map(async (provider): Promise<MatchCandidate | null> => {
      const location = await getDriverLocation(provider.user.id);
      if (!location) return null;

      const distanceKm = haversineKm(pickupLat, pickupLng, location.lat, location.lng);
      const serviceRadiusKm = Number(provider.serviceRadiusKm);
      if (Number.isFinite(serviceRadiusKm) && serviceRadiusKm > 0 && distanceKm > serviceRadiusKm) return null;

      const vehicle = provider.user.vehicles.find((candidate) =>
        matchesRequirement(candidate.type, requirements.vehicleTypes)
        && matchesRequirement(candidate.subtype, requirements.vehicleSubtypes)
        && (requirements.minCapacityKg === null || (candidate.capacityKg !== null && Number(candidate.capacityKg) >= requirements.minCapacityKg))
        && (requirements.minVolumeM3 === null || (candidate.volumeM3 !== null && Number(candidate.volumeM3) >= requirements.minVolumeM3))
        && (!requirements.refrigerated || candidate.refrigerated),
      );
      if (!vehicle && (requirements.vehicleTypes.length > 0 || requirements.vehicleSubtypes.length > 0 || requirements.minCapacityKg !== null || requirements.minVolumeM3 !== null || requirements.refrigerated)) return null;

      const route = await routing.route(
        { lat: location.lat, lng: location.lng },
        { lat: pickupLat, lng: pickupLng },
      );
      const etaMinutes = route ? Math.max(1, Math.ceil(route.durationSeconds / 60)) : null;
      const distanceScore = Math.max(0, 40 - Math.min(distanceKm, 40));
      const ratingScore = Number(provider.rating) * 6;
      const reliabilityScore = Number(provider.reliabilityScore) * 0.2;
      const etaScore = etaMinutes === null ? 0 : Math.max(0, 20 - Math.min(etaMinutes, 20));
      const vehicleScore = vehicle ? 10 : 0;
      const score = distanceScore + ratingScore + reliabilityScore + etaScore + vehicleScore;

      return {
        providerId: provider.user.id,
        score,
        distanceKm,
        rating: Number(provider.rating),
        reliabilityScore: Number(provider.reliabilityScore),
        etaMinutes,
        vehicleId: vehicle?.id ?? null,
        vehicleType: vehicle?.type ?? null,
        vehicleSubtype: vehicle?.subtype ?? null,
        capacityKg: vehicle?.capacityKg === null || vehicle?.capacityKg === undefined ? null : Number(vehicle.capacityKg),
        volumeM3: vehicle?.volumeM3 === null || vehicle?.volumeM3 === undefined ? null : Number(vehicle.volumeM3),
        refrigerated: vehicle?.refrigerated ?? false,
      };
    }),
  );

  return candidates
    .filter((candidate): candidate is MatchCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score);
}
