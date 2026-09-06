import { afterEach, describe, expect, it, vi } from "vitest";
import { findMatches } from "./engine";

const { findNearbyDriverIds } = vi.hoisted(() => ({ findNearbyDriverIds: vi.fn() }));
const { getDriverLocation } = vi.hoisted(() => ({ getDriverLocation: vi.fn() }));
const { getRoutingProvider } = vi.hoisted(() => ({ getRoutingProvider: vi.fn() }));
vi.mock("../tracking/state", () => ({ findNearbyDriverIds, getDriverLocation }));
vi.mock("../routing/provider", () => ({ getRoutingProvider }));

afterEach(() => { vi.clearAllMocks(); delete process.env.MATCHING_MAX_RADIUS_KM; });

describe("matching engine", () => {
  it("returns no matches without pickup coordinates", async () => {
    const prisma = { order: { findUnique: vi.fn().mockResolvedValue({ id: "o1", pickupLat: null, pickupLng: null }) } } as never;
    await expect(findMatches(prisma, "o1")).resolves.toEqual([]);
    expect(findNearbyDriverIds).not.toHaveBeenCalled();
  });

  it("filters incompatible vehicle requirements", async () => {
    findNearbyDriverIds.mockResolvedValue(["d1", "d2"]);
    getDriverLocation.mockResolvedValue({ driverId: "d1", lat: 38.72, lng: 35.49, timestamp: new Date().toISOString() });
    getRoutingProvider.mockReturnValue({ route: vi.fn().mockResolvedValue(null) });
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue({ id: "o1", pickupLat: 38.72, pickupLng: 35.49, payload: { vehicleTypes: ["TRUCK"], minCapacityKg: 5000, refrigerated: true } }) },
      user: { findMany: vi.fn().mockResolvedValue([
        { id: "d1", role: "DRIVER", vehicles: [{ id: "v1", type: "TRUCK", subtype: null, capacityKg: "10000", volumeM3: "30", refrigerated: true }], driverProfile: { serviceRadiusKm: "50", rating: "4.5", reliabilityScore: "90" }, serviceProvider: null },
        { id: "d2", role: "DRIVER", vehicles: [{ id: "v2", type: "VAN", subtype: null, capacityKg: "10000", volumeM3: "30", refrigerated: true }], driverProfile: { serviceRadiusKm: "50", rating: "5", reliabilityScore: "100" }, serviceProvider: null },
      ]) },
    } as never;
    const matches = await findMatches(prisma, "o1");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ providerId: "d1", vehicleId: "v1", capacityKg: 10000, refrigerated: true });
  });

  it("matches service-provider category and tolerates routing outage", async () => {
    findNearbyDriverIds.mockResolvedValue(["p1"]);
    getDriverLocation.mockResolvedValue({ driverId: "p1", lat: 38.721, lng: 35.491, timestamp: new Date().toISOString() });
    getRoutingProvider.mockReturnValue({ route: vi.fn().mockResolvedValue(null) });
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue({ id: "o2", pickupLat: 38.72, pickupLng: 35.49, payload: { providerCategory: "WAREHOUSE" } }) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: "p1", role: "SERVICE_PROVIDER", vehicles: [], driverProfile: null, serviceProvider: { category: "WAREHOUSE", serviceRadiusKm: "50", rating: "4", reliabilityScore: "80" } }]) },
    } as never;
    const matches = await findMatches(prisma, "o2");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ providerId: "p1", providerRole: "SERVICE_PROVIDER", etaMinutes: null });
  });
});
