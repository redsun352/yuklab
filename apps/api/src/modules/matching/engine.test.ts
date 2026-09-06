import { describe, expect, it, vi } from "vitest";
import { findMatches } from "./engine";

const { findNearbyDriverIds } = vi.hoisted(() => ({
  findNearbyDriverIds: vi.fn(),
}));
const { getDriverLocation } = vi.hoisted(() => ({
  getDriverLocation: vi.fn(),
}));
const { getRoutingProvider } = vi.hoisted(() => ({
  getRoutingProvider: vi.fn(),
}));

vi.mock("../tracking/state", () => ({ findNearbyDriverIds, getDriverLocation }));
vi.mock("../routing/provider", () => ({ getRoutingProvider }));

describe("matching engine", () => {
  it("returns no matches when pickup coordinates are unavailable", async () => {
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue({ id: "order-1", pickupLat: null, pickupLng: null }) },
    } as never;

    await expect(findMatches(prisma, "order-1")).resolves.toEqual([]);
    expect(findNearbyDriverIds).not.toHaveBeenCalled();
  });

  it("filters inactive providers and incompatible vehicles, then ranks eligible candidates", async () => {
    process.env.MATCHING_MAX_RADIUS_KM = "50";
    findNearbyDriverIds.mockResolvedValue(["driver-1", "provider-1", "driver-2"]);
    getDriverLocation.mockImplementation(async (id: string) => ({
      driverId: id,
      lat: id === "driver-2" ? 38.90 : 38.72,
      lng: id === "driver-2" ? 35.80 : 35.49,
      timestamp: new Date().toISOString(),
    }));
    getRoutingProvider.mockReturnValue({
      route: vi.fn().mockResolvedValue({ distanceMeters: 9000, durationSeconds: 600 }),
    });

    const prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: "order-1",
          pickupLat: "38.7200000",
          pickupLng: "35.4900000",
          payload: {
            vehicleTypes: ["TRUCK"],
            vehicleSubtypes: ["TENTELI"],
            weightKg: 5000,
            volumeM3: 20,
            refrigerated: true,
          },
        }),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "driver-1",
            role: "DRIVER",
            vehicles: [{ id: "vehicle-1", type: "TRUCK", subtype: "TENTELI", capacityKg: "10000", volumeM3: "30", refrigerated: true }],
            driverProfile: { serviceRadiusKm: "50", rating: "4.8", reliabilityScore: "95" },
            serviceProvider: null,
          },
          {
            id: "provider-1",
            role: "SERVICE_PROVIDER",
            vehicles: [{ id: "vehicle-2", type: "TRUCK", subtype: "TENTELI", capacityKg: "3000", volumeM3: "30", refrigerated: true }],
            driverProfile: null,
            serviceProvider: { category: "CARRIER", serviceRadiusKm: "50", rating: "5", reliabilityScore: "100" },
          },
          {
            id: "driver-2",
            role: "DRIVER",
            vehicles: [{ id: "vehicle-3", type: "VAN", subtype: "CLOSED", capacityKg: "10000", volumeM3: "30", refrigerated: true }],
            driverProfile: { serviceRadiusKm: "50", rating: "5", reliabilityScore: "100" },
            serviceProvider: null,
          },
        ]),
      },
    } as never;

    const matches = await findMatches(prisma, "order-1");

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      providerId: "driver-1",
      providerRole: "DRIVER",
      vehicleId: "vehicle-1",
      vehicleType: "TRUCK",
      vehicleSubtype: "TENTELI",
      capacityKg: 10000,
      volumeM3: 30,
      refrigerated: true,
    });
    expect(matches[0].score).toBeGreaterThan(0);
  });

  it("supports service-provider category matching and routing fallback", async () => {
    findNearbyDriverIds.mockResolvedValue(["provider-1"]);
    getDriverLocation.mockResolvedValue({
      driverId: "provider-1",
      lat: 38.721,
      lng: 35.491,
      timestamp: new Date().toISOString(),
    });
    getRoutingProvider.mockReturnValue({ route: vi.fn().mockResolvedValue(null) });

    const prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: "order-2",
          pickupLat: 38.72,
          pickupLng: 35.49,
          payload: { providerCategory: "WAREHOUSE", vehicleTypes: [] },
        }),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "provider-1",
            role: "SERVICE_PROVIDER",
            vehicles: [],
            driverProfile: null,
            serviceProvider: { category: "WAREHOUSE", serviceRadiusKm: "50", rating: "4", reliabilityScore: "80" },
          },
        ]),
      },
    } as never;

    const matches = await findMatches(prisma, "order-2");

    expect(matches).toHaveLength(1);
    expect(matches[0].providerId).toBe("provider-1");
    expect(matches[0].etaMinutes).toBeNull();
  });
});
