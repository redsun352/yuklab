import { describe, expect, it } from "vitest";
import { canActorTransition, canTransition } from "./transitions";

describe("order transitions", () => {
  it("allows the normal delivery lifecycle", () => {
    const lifecycle = [
      ["PUBLISHED", "OFFERING"],
      ["OFFERING", "ACCEPTED"],
      ["ACCEPTED", "DRIVER_ASSIGNED"],
      ["DRIVER_ASSIGNED", "EN_ROUTE_PICKUP"],
      ["EN_ROUTE_PICKUP", "ARRIVED_PICKUP"],
      ["ARRIVED_PICKUP", "LOADED"],
      ["LOADED", "IN_TRANSIT"],
      ["IN_TRANSIT", "ARRIVED_DELIVERY"],
      ["ARRIVED_DELIVERY", "DELIVERED"],
      ["DELIVERED", "COMPLETED"],
    ] as const;

    for (const [from, to] of lifecycle) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it("blocks skipping lifecycle states", () => {
    expect(canTransition("DRIVER_ASSIGNED", "LOADED")).toBe(false);
    expect(canTransition("IN_TRANSIT", "COMPLETED")).toBe(false);
    expect(canTransition("COMPLETED", "IN_TRANSIT")).toBe(false);
  });

  it("allows only the assigned driver to advance delivery state", () => {
    expect(canActorTransition(
      "DRIVER", "driver-1", "customer-1", "driver-1", "DRIVER_ASSIGNED", "EN_ROUTE_PICKUP",
    )).toBe(true);
    expect(canActorTransition(
      "DRIVER", "driver-2", "customer-1", "driver-1", "DRIVER_ASSIGNED", "EN_ROUTE_PICKUP",
    )).toBe(false);
    expect(canActorTransition(
      "CUSTOMER", "customer-1", "customer-1", "driver-1", "DRIVER_ASSIGNED", "EN_ROUTE_PICKUP",
    )).toBe(false);
  });

  it("allows customer or assigned driver to cancel an active order", () => {
    expect(canActorTransition(
      "CUSTOMER", "customer-1", "customer-1", "driver-1", "EN_ROUTE_PICKUP", "CANCELLED",
    )).toBe(true);
    expect(canActorTransition(
      "DRIVER", "driver-1", "customer-1", "driver-1", "EN_ROUTE_PICKUP", "CANCELLED",
    )).toBe(true);
    expect(canActorTransition(
      "DRIVER", "driver-2", "customer-1", "driver-1", "EN_ROUTE_PICKUP", "CANCELLED",
    )).toBe(false);
  });

  it("allows admins to resolve valid transitions", () => {
    expect(canActorTransition(
      "ADMIN", "admin-1", "customer-1", "driver-1", "IN_TRANSIT", "ARRIVED_DELIVERY",
    )).toBe(true);
  });
});
