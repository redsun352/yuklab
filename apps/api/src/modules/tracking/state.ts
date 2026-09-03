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
    await redis!.set(key(location.driverId), JSON.stringify(location), "EX", ttlSeconds);
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
