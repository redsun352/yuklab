import type { PrismaClient } from "@yuklab/database";
import { findNearbyDriverIds, getDriverLocation } from "../tracking/state";
import { getRoutingProvider } from "../routing/provider";

type MatchCandidate = {
  providerId: string;
  providerRole: "DRIVER" | "SERVICE_PROVIDER";
  providerCategory: string | null;
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
  providerCategories: string[];
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

function stringList(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  return stringArray(value);
}

function positiveNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function requirementsFromPayload(payload: unknown): OrderRequirements {
  const empty: OrderRequirements = {
    vehicleTypes: [],
    vehicleSubtypes: [],
    providerCategories: [],
    minCapacityKg: null,
    minVolumeM3: null,
    refrigerated: false,
  };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return empty;

  const data = payload as Record<string, unknown>;
  const vehicle = data.vehicle && typeof data.vehicle === "object" && !Array.isArray(data.vehicle)
    ? data.vehicle as Record<string, unknown>
    : {};
  const load = data.load && typeof data.load === "object" && !Array.isArray(data.load)
    ? data.load as Record<string, unknown>
    : {};

  return {
    vehicleTypes: stringList(data.vehicleTypes ?? data.requiredVehicleTypes ?? vehicle.types ?? vehicle.type),
    vehicleSubtypes: stringList(data.vehicleSubtypes ?? data.requiredVehicleSubtypes ?? vehicle.subtypes ?? vehicle.subtype),
    providerCategories: stringList(
      data.providerCategories ?? data.requiredProviderCategories ?? data.providerCategory,
    ),
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

function safeDecimal(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export async function findMatches(prisma: PrismaClient, orderId: string): Promise<MatchCandidate[]> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.pickupLat === null || order.pickupLng === null) return [];

  const requirements = requirementsFromPayload(order.payload);
  const pickupLat = Number(order.pickupLat);
  const pickupLng = Number(order.pickupLng);
  if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng) || Math.abs(pickupLat) > 90 || Math.abs(pickupLng) > 180) return [];

  const configuredRadius = Number(process.env.MATCHING_MAX_RADIUS_KM ?? 50);
  const maxRadiusKm = Number.isFinite(configuredRadius) && configuredRadius > 0 ? configuredRadius : 50;
  const nearbyIds = await findNearbyDriverIds(pickupLat, pickupLng, maxRadiusKm);
  if (nearbyIds.length === 0) return [];

  // A provider is eligible when it has either a live driver profile or a live
  // service-provider profile. Both use the same GPS/vehicle matching path.
  const providers = await prisma.user.findMany({
    where: {
      id: { in: nearbyIds },
      status: "ACTIVE",
      role: { in: ["DRIVER", "SERVICE_PROVIDER"] },
      OR: [
        { driverProfile: { is: { isOnline: true, isAvailable: true } } },
        { serviceProvider: { is: { isOnline: true, isAvailable: true } } },
      ],
    },
    select: {
      id: true,
      role: true,
      vehicles: {
        where: { active: true },
        orderBy: { updatedAt: "desc" },
        select: { id: true, type: true, subtype: true, capacityKg: true, volumeM3: true, refrigerated: true },
      },
      driverProfile: {
        select: {
          serviceRadiusKm: true,
          rating: true,
          reliabilityScore: true,
        },
      },
      serviceProvider: {
        select: {
          category: true,
          serviceRadiusKm: true,
          rating: true,
          reliabilityScore: true,
        },
      },
    },
  });

  const routing = getRoutingProvider();
  const candidates = await Promise.all(
    providers.map(async (provider): Promise<MatchCandidate | null> => {
      const location = await getDriverLocation(provider.id);
      if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng) || Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180) return null;

      const distanceKm = haversineKm(pickupLat, pickupLng, location.lat, location.lng);
      const profile = provider.role === "SERVICE_PROVIDER" ? provider.serviceProvider : provider.driverProfile;
      if (!profile) return null;

      const category = provider.serviceProvider?.category ?? null;
      const serviceRadiusKm = Number(profile.serviceRadiusKm);
      if (Number.isFinite(serviceRadiusKm) && serviceRadiusKm > 0 && distanceKm > serviceRadiusKm) return null;
      if (!matchesRequirement(category, requirements.providerCategories)) return null;

      const vehicle = provider.vehicles.find((candidate) =>
        matchesRequirement(candidate.type, requirements.vehicleTypes)
        && matchesRequirement(candidate.subtype, requirements.vehicleSubtypes)
        && (requirements.minCapacityKg === null || (candidate.capacityKg !== null && Number(candidate.capacityKg) >= requirements.minCapacityKg))
        && (requirements.minVolumeM3 === null || (candidate.volumeM3 !== null && Number(candidate.volumeM3) >= requirements.minVolumeM3))
        && (!requirements.refrigerated || candidate.refrigerated),
      );
      const hasVehicleRequirement = requirements.vehicleTypes.length > 0
        || requirements.vehicleSubtypes.length > 0
        || requirements.minCapacityKg !== null
        || requirements.minVolumeM3 !== null
        || requirements.refrigerated;
      if (!vehicle && hasVehicleRequirement) return null;

      const route = await routing.route(
        { lat: location.lat, lng: location.lng },
        { lat: pickupLat, lng: pickupLng },
      );
      const etaMinutes = route ? Math.max(1, Math.ceil(route.durationSeconds / 60)) : null;

      // Transparent 100-point score: proximity 35, rating 25, reliability 20,
      // ETA 10 and vehicle suitability 10. Hard requirements are filtered above.
      const distanceScore = Math.max(0, 35 * (1 - Math.min(distanceKm, maxRadiusKm) / maxRadiusKm));
      const rating = safeDecimal(profile.rating, 0, 5, 0);
      const reliability = safeDecimal(profile.reliabilityScore, 0, 100, 0);
      const ratingScore = rating * 5;
      const reliabilityScore = reliability * 0.2;
      const etaScore = etaMinutes === null ? 0 : 10 * (1 - Math.min(etaMinutes, 60) / 60);
      const vehicleScore = vehicle ? 10 : 0;
      const score = Math.min(100, Math.max(0, distanceScore + ratingScore + reliabilityScore + etaScore + vehicleScore));

      return {
        providerId: provider.id,
        providerRole: provider.role,
        providerCategory: category,
        score,
        distanceKm,
        rating,
        reliabilityScore: reliability,
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
