import { afterEach, describe, expect, it, vi } from "vitest";
import { getRoutingProvider, type RoutePoint } from "./provider";

describe("routing provider", () => {
  const originalProvider = process.env.ROUTING_PROVIDER;
  const originalBaseUrl = process.env.ROUTING_BASE_URL;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalProvider === undefined) delete process.env.ROUTING_PROVIDER;
    else process.env.ROUTING_PROVIDER = originalProvider;
    if (originalBaseUrl === undefined) delete process.env.ROUTING_BASE_URL;
    else process.env.ROUTING_BASE_URL = originalBaseUrl;
  });

  it("returns no route when routing is disabled", async () => {
    delete process.env.ROUTING_PROVIDER;
    const provider = getRoutingProvider();
    await expect(provider.route({ lat: 38.72, lng: 35.49 }, { lat: 38.73, lng: 35.50 })).resolves.toBeNull();
  });

  it("parses an OSRM route and converts geometry to lat/lng points", async () => {
    process.env.ROUTING_PROVIDER = "osrm";
    process.env.ROUTING_BASE_URL = "https://routing.test";
    process.env.ROUTING_TIMEOUT_MS = "1000";

    const response = {
      ok: true,
      json: async () => ({
        routes: [{
          distance: 1234.5,
          duration: 98.7,
          geometry: { coordinates: [[35.49, 38.72], [35.50, 38.73]] },
        }],
      }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const from: RoutePoint = { lat: 38.72, lng: 35.49 };
    const to: RoutePoint = { lat: 38.73, lng: 35.50 };
    const result = await getRoutingProvider().route(from, to);

    expect(result).toEqual({
      distanceMeters: 1234.5,
      durationSeconds: 98.7,
      geometry: [from, to],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://routing.test/route/v1/driving/35.49,38.72;35.5,38.73?overview=full&geometries=geojson&steps=false",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns null when the routing service fails", async () => {
    process.env.ROUTING_PROVIDER = "osrm";
    process.env.ROUTING_BASE_URL = "https://routing.test";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));

    await expect(getRoutingProvider().route({ lat: 38.72, lng: 35.49 }, { lat: 38.73, lng: 35.50 })).resolves.toBeNull();
  });
});
