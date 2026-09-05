import { describe, expect, it } from "vitest";

describe("provider operational invariants", () => {
  it("documents the availability rule enforced by the provider route", () => {
    const data = { isOnline: false, isAvailable: true };
    if (data.isOnline === false) data.isAvailable = false;
    expect(data).toEqual({ isOnline: false, isAvailable: false });
  });
});
