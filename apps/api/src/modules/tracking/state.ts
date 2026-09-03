import Redis from "ioredis";

export type DriverLocation = {
  driverId: string;
  lat: number;
  lng: number;
  heading?: number;
  speedKph?: number;
  accuracyM?: number;
  timestamp: string;
};

const locations = new Map<string, DriverLocation>();
const ttlSeconds = Number(process.env.TRACKING_LOCATION_TTL_SECONDS ?? 120);
const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;
const geoKey = "yuklab:tracking:drivers:geo";
const seenKey = "yuklab:tracking:drivers:seen";

function key(driverId: string): string {
  return `yuklab:tracking:driver:${driverId}`;
}

async function ensureRedis(): Promise<boolean> {
  if (!redis) return false;
  if (redis.status === "ready") return true;
  try {
    await redis.connect();
    return true;
  } catch {
    return false;
  }
}

export async function setDriverLocation(location: DriverLocation): Promise<void> {
  locations.set(location.driverId, location);
  if (!(await ensureRedis())) return;
  try {
    const timestampMs = Date.parse(location.timestamp);
    await redis!.multi()
      .set(key(location.driverId), JSON.stringify(location), "EX", ttlSeconds)
      .geoadd(geoKey, location.lng, location.lat, location.driverId)
      .zadd(seenKey, timestampMs, location.driverId)
      .exec();
  } catch {
    // Memory remains the local fallback when Redis is temporarily unavailable.
  }
}

export async function getDriverLocation(driverId: string): Promise<DriverLocation | undefined> {
  if (await ensureRedis()) {
    try {
      const value = await redis!.get(key(driverId));
      if (value) return JSON.parse(value) as DriverLocation;
    } catch {
      // Fall through to the local process cache.
    }
  }
  return locations.get(driverId);
}

export async function findNearbyDriverIds(
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<string[]> {
  if (!(await ensureRedis())) return [];
  try {
    const cutoff = Date.now() - ttlSeconds * 1000;
    const stale = await redis!.zrangebyscore(seenKey, 0, cutoff);
    if (stale.length > 0) {
      await redis!.multi().zrem(seenKey, ...stale).zrem(geoKey, ...stale).exec();
    }
    const nearby = await redis!.geosearch(
      geoKey,
      "FROMLONLAT",
      lng,
      lat,
      radiusKm,
      "km",
    );
    return nearby.map(String);
  } catch {
    return [];
  }
}
