export type RoutePoint = { lat: number; lng: number };

export type RouteResult = {
  distanceMeters: number;
  durationSeconds: number;
  geometry?: RoutePoint[];
};

export interface RoutingProvider {
  route(from: RoutePoint, to: RoutePoint): Promise<RouteResult | null>;
}

class NoneRoutingProvider implements RoutingProvider {
  async route(): Promise<RouteResult | null> {
    return null;
  }
}

class OsrmRoutingProvider implements RoutingProvider {
  constructor(private readonly baseUrl: string) {}

  async route(from: RoutePoint, to: RoutePoint): Promise<RouteResult | null> {
    const controller = new AbortController();
    const timeoutMs = Number(process.env.ROUTING_TIMEOUT_MS ?? 5000);
    const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 5000);
    try {
      const url = `${this.baseUrl.replace(/\/$/, "")}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=false`;
      const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        routes?: Array<{ distance?: number; duration?: number; geometry?: { coordinates?: Array<[number, number]> } }>;
      };
      const route = body.routes?.[0];
      if (!route || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) return null;
      const geometry = route.geometry?.coordinates
        ?.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
        .map(([lng, lat]) => ({ lat, lng }));
      return {
        distanceMeters: route.distance!,
        durationSeconds: route.duration!,
        geometry: geometry && geometry.length >= 2 ? geometry : undefined,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function getRoutingProvider(): RoutingProvider {
  const provider = (process.env.ROUTING_PROVIDER ?? "none").toLowerCase();
  if (provider === "osrm") return new OsrmRoutingProvider(process.env.ROUTING_BASE_URL ?? "https://router.project-osrm.org");
  return new NoneRoutingProvider();
}
