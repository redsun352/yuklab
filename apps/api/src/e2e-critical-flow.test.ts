import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./server";
import { prisma } from "./lib/prisma";

const app = buildApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const customerEmail = `e2e-customer-${suffix}@example.com`;
const providerEmail = `e2e-provider-${suffix}@example.com`;
const password = "YukLab-E2E-Strong-Password-2026!";

async function registerAndLogin(email: string, firstName: string, lastName: string) {
  const register = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, firstName, lastName, password, preferredLanguage: "tr-TR" },
  });
  expect(register.statusCode).toBe(201);

  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { identifier: email, password },
  });
  expect(login.statusCode).toBe(200);
  return JSON.parse(login.body) as { accessToken: string; user: { id: string } };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("critical customer-provider order flow", () => {
  let customer: { accessToken: string; user: { id: string } };
  let provider: { accessToken: string; user: { id: string } };
  let orderId = "";

  beforeAll(async () => {
    customer = await registerAndLogin(customerEmail, "E2E", "Customer");
    provider = await registerAndLogin(providerEmail, "E2E", "Provider");

    await prisma.user.update({
      where: { id: provider.user.id },
      data: { role: "SERVICE_PROVIDER" },
    });
    await prisma.driverProfile.create({
      data: {
        userId: provider.user.id,
        isOnline: true,
        isAvailable: true,
        rating: 5,
        reliabilityScore: 100,
      },
    });
  });

  afterAll(async () => {
    if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.driverProfile.deleteMany({ where: { userId: { in: [customer.user.id, provider.user.id] } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: [customer.user.id, provider.user.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [customer.user.id, provider.user.id] } } });
    await app.close();
  });

  it("runs order creation through delivery completion and tracking", async () => {
    const createOrder = await app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: auth(customer.accessToken),
      payload: {
        serviceType: "Yük Taşımacılığı",
        pickupAddress: "Kayseri Talas",
        deliveryAddress: "Kayseri OSB",
        pickupLat: 38.6908,
        pickupLng: 35.5538,
        deliveryLat: 38.7569,
        deliveryLng: 35.4047,
        budgetMinor: "250000",
        currency: "TRY",
      },
    });
    expect(createOrder.statusCode).toBe(201);
    orderId = JSON.parse(createOrder.body).order.id;
    expect(JSON.parse(createOrder.body).order.status).toBe("PUBLISHED");

    const createOffer = await app.inject({
      method: "POST",
      url: `/v1/orders/${orderId}/offers`,
      headers: auth(provider.accessToken),
      payload: {
        amountMinor: "225000",
        currency: "TRY",
        etaMinutes: 45,
        note: "E2E provider offer",
      },
    });
    expect(createOffer.statusCode).toBe(201);
    const offerId = JSON.parse(createOffer.body).offer.id;

    const offers = await app.inject({
      method: "GET",
      url: `/v1/orders/${orderId}/offers`,
      headers: auth(customer.accessToken),
    });
    expect(offers.statusCode).toBe(200);
    expect(JSON.parse(offers.body).offers).toHaveLength(1);

    const accept = await app.inject({
      method: "POST",
      url: `/v1/orders/${orderId}/offers/${offerId}/accept`,
      headers: auth(customer.accessToken),
    });
    expect(accept.statusCode).toBe(200);
    expect(JSON.parse(accept.body).order.status).toBe("DRIVER_ASSIGNED");
    expect(JSON.parse(accept.body).order.assignedDriverId).toBe(provider.user.id);

    const preTrackingStatuses = ["EN_ROUTE_PICKUP", "ARRIVED_PICKUP", "LOADED", "IN_TRANSIT"];
    for (const status of preTrackingStatuses) {
      const transition = await app.inject({
        method: "POST",
        url: `/v1/orders/${orderId}/status`,
        headers: auth(provider.accessToken),
        payload: { status },
      });
      expect(transition.statusCode, `transition to ${status}`).toBe(200);
      expect(JSON.parse(transition.body).order.status).toBe(status);
    }

    const gps = await app.inject({
      method: "POST",
      url: "/v1/tracking/location",
      headers: auth(provider.accessToken),
      payload: {
        orderId,
        lat: 38.72,
        lng: 35.50,
        heading: 90,
        speedKph: 42,
        accuracyM: 8,
      },
    });
    expect(gps.statusCode).toBe(204);

    const tracking = await app.inject({
      method: "GET",
      url: `/v1/tracking/orders/${orderId}/location`,
      headers: auth(customer.accessToken),
    });
    expect(tracking.statusCode).toBe(200);
    expect(JSON.parse(tracking.body).location.driverId).toBe(provider.user.id);
    expect(JSON.parse(tracking.body).location.lat).toBe(38.72);

    for (const status of ["ARRIVED_DELIVERY", "DELIVERED", "COMPLETED"]) {
      const transition = await app.inject({
        method: "POST",
        url: `/v1/orders/${orderId}/status`,
        headers: auth(provider.accessToken),
        payload: { status },
      });
      expect(transition.statusCode, `transition to ${status}`).toBe(200);
      expect(JSON.parse(transition.body).order.status).toBe(status);
    }

    const inactiveTracking = await app.inject({
      method: "GET",
      url: `/v1/tracking/orders/${orderId}/location`,
      headers: auth(customer.accessToken),
    });
    expect(inactiveTracking.statusCode).toBe(409);
    expect(JSON.parse(inactiveTracking.body).error).toBe("TRACKING_NOT_ACTIVE");
  });
});
