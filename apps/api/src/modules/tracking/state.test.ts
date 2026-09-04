import { afterEach, describe, expect, it, vi } from "vitest";
import { findNearbyDriverIds, getDriverLocation, setDriverLocation } from "./state";

describe("driver tracking state", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and returns a fresh driver location", async () => {
    const driverId = `tracking-test-${Date.now()}-fresh`;
    const timestamp = new Date().toISOString();

    await setDriverLocation({
      driverId,
      lat: 38.7225,
      lng: 35.4875,
      heading: 90,
      speedKph: 32,
      accuracyM: 5,
      timestamp,
    });

    await expect(getDriverLocation(driverId)).resolves.toMatchObject({
      driverId,
      lat: 38.7225,
      lng: 35.4875,
      heading: 90,
    });
  });

  it("falls back to the in-memory geo index and sorts by distance", async () => {
    const prefix = `tracking-test-${Date.now()}-nearby`;
    const now = new Date().toISOString();

    await setDriverLocation({ driverId: `${prefix}-far`, lat: 38.75, lng: 35.52, timestamp: now });
    await setDriverLocation({ driverId: `${prefix}-near`, lat: 38.723, lng: 35.489, timestamp: now });
    await setDriverLocation({ driverId: `${prefix}-outside`, lat: 39.1, lng: 35.9, timestamp: now });

    const nearby = await findNearbyDriverIds(38.7225, 35.4875, 5);
    const testDrivers = nearby.filter((driverId) => driverId.startsWith(prefix));

    expect(testDrivers).toEqual([
      `${prefix}-near`,
      `${prefix}-far`,
    ]);
  });

  it("does not return stale in-memory locations", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-09-04T00:00:00.000Z");
    vi.setSystemTime(now);
    const driverId = `tracking-test-${Date.now()}-stale`;

    await setDriverLocation({
      driverId,
      lat: 38.7225,
      lng: 35.4875,
      timestamp: now.toISOString(),
    });

    vi.setSystemTime(new Date(now.getTime() + 121_000));

    await expect(getDriverLocation(driverId)).resolves.toBeUndefined();
    await expect(findNearbyDriverIds(38.7225, 35.4875, 5)).resolves.not.toContain(driverId);
  });

  it("rejects future-dated locations", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-09-04T00:00:00.000Z");
    vi.setSystemTime(now);
    const driverId = `tracking-test-${Date.now()}-future`;

    await setDriverLocation({
      driverId,
      lat: 38.7225,
      lng: 35.4875,
      timestamp: new Date(now.getTime() + 61_000).toISOString(),
    });

    await expect(getDriverLocation(driverId)).resolves.toBeUndefined();
    await expect(findNearbyDriverIds(38.7225, 35.4875, 5)).resolves.not.toContain(driverId);
  });

  it("rejects invalid geo search inputs", async () => {
    await expect(findNearbyDriverIds(Number.NaN, 35.4875, 5)).resolves.toEqual([]);
    await expect(findNearbyDriverIds(38.7225, 35.4875, 0)).resolves.toEqual([]);
  });
});
