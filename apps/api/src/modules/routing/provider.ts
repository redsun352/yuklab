export type RoutePoint = { lat: number; lng: number };

export type RouteResult = {
  distanceMeters: number;
  durationSeconds: number;
  polyline?: string;
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
    const timeout = setTimeout(() => controller.abort(), Number(process.env.ROUTING_TIMEOUT_MS ?? 5000));
    try {
      const url = `${this.baseUrl.replace(/\/$/, "")}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
      const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
      if (!response.ok) return null;
      const body = (await response.json()) as { routes?: Array<{ distance?: number; duration?: number }> };
      const route = body.routes?.[0];
      if (!route || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) return null;
      return { distanceMeters: route.distance!, durationSeconds: route.duration! };
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
