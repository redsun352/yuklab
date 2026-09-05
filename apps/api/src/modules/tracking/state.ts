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
const lastPersistedAt = new Map<string, number>();
const ttlSeconds = Number(process.env.TRACKING_LOCATION_TTL_SECONDS ?? 120);
const persistIntervalSeconds = Number(process.env.TRACKING_LOCATION_PERSIST_INTERVAL_SECONDS ?? 30);
const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;
const geoKey = "yuklab:tracking:drivers:geo";
const seenKey = "yuklab:tracking:drivers:seen";

function key(driverId: string): string {
  return `yuklab:tracking:driver:${driverId}`;
}

function isFresh(location: DriverLocation): boolean {
  const timestampMs = Date.parse(location.timestamp);
  if (!Number.isFinite(timestampMs)) return false;
  const now = Date.now();
  return timestampMs >= now - ttlSeconds * 1000 && timestampMs <= now + 60_000;
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

export async function setDriverLocation(location: DriverLocation): Promise<boolean> {
  if (!isFresh(location)) return false;
  locations.set(location.driverId, location);
  if (!(await ensureRedis())) return false;
  try {
    const timestampMs = Date.parse(location.timestamp);
    await redis!.multi()
      .set(key(location.driverId), JSON.stringify(location), "EX", ttlSeconds)
      .geoadd(geoKey, location.lng, location.lat, location.driverId)
      .zadd(seenKey, timestampMs, location.driverId)
      .exec();

    const now = Date.now();
    const intervalMs = Math.max(5, Number.isFinite(persistIntervalSeconds) ? persistIntervalSeconds : 30) * 1000;
    const last = lastPersistedAt.get(location.driverId) ?? 0;
    if (now - last >= intervalMs) {
      lastPersistedAt.set(location.driverId, now);
      return true;
    }
  } catch {
    // Memory remains the local fallback when Redis is temporarily unavailable.
  }
  return false;
}

export async function getDriverLocation(driverId: string): Promise<DriverLocation | undefined> {
  if (await ensureRedis()) {
    try {
      const value = await redis!.get(key(driverId));
      if (value) {
        const location = JSON.parse(value) as DriverLocation;
        if (isFresh(location)) return location;
      }
    } catch {
      // Fall through to the local process cache.
    }
  }

  const location = locations.get(driverId);
  if (!location || !isFresh(location)) {
    if (location) locations.delete(driverId);
    return undefined;
  }
  return location;
}

export async function findNearbyDriverIds(
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<string[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusKm) || radiusKm <= 0) return [];

  if (await ensureRedis()) {
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
      // Fall through to the in-process location index.
    }
  }

  const nearby: Array<{ driverId: string; distanceKm: number }> = [];
  for (const location of locations.values()) {
    if (!isFresh(location)) {
      locations.delete(location.driverId);
      continue;
    }

    const toRad = (value: number) => (value * Math.PI) / 180;
    const earthRadiusKm = 6371;
    const dLat = toRad(location.lat - lat);
    const dLng = toRad(location.lng - lng);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat)) * Math.cos(toRad(location.lat)) * Math.sin(dLng / 2) ** 2;
    const distanceKm = earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    if (distanceKm <= radiusKm) nearby.push({ driverId: location.driverId, distanceKm });
  }

  return nearby
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map(({ driverId }) => driverId);
}
