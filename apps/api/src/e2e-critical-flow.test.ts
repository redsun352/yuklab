import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./server";
import { prisma } from "./lib/prisma";
import { setDriverLocation } from "./modules/tracking/state";

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
  let customerId: string | undefined;
  let providerId: string | undefined;
  let customer: { accessToken: string; user: { id: string } } | undefined;
  let provider: { accessToken: string; user: { id: string } } | undefined;
  let orderId: string | undefined;
  const contentionOrderIds: string[] = [];
  let vehicleId: string | undefined;

  beforeAll(async () => {
    customer = await registerAndLogin(customerEmail, "E2E", "Customer");
    customerId = customer.user.id;

    provider = await registerAndLogin(providerEmail, "E2E", "Provider");
    providerId = provider.user.id;

    await prisma.user.update({
      where: { id: providerId },
      data: { role: "SERVICE_PROVIDER" },
    });
    await prisma.serviceProvider.create({
      data: {
        userId: providerId,
        category: "Yük Taşımacılığı",
        isOnline: true,
        isAvailable: true,
        rating: 5,
        reliabilityScore: 100,
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        ownerId: providerId,
        type: "Kamyon",
        subtype: "Standart",
        plateNumber: `E2E-${suffix.slice(-8).toUpperCase()}`,
        capacityKg: 20000,
        volumeM3: 50,
        active: true,
      },
    });
    vehicleId = vehicle.id;
    await setDriverLocation({
      driverId: providerId,
      lat: 38.7000,
      lng: 35.5400,
      heading: 90,
      speedKph: 0,
      accuracyM: 5,
      timestamp: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    const orderIds = [orderId, ...contentionOrderIds].filter((id): id is string => Boolean(id));
    if (orderIds.length > 0) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    const userIds = [customerId, providerId].filter((id): id is string => Boolean(id));
    if (userIds.length > 0) {
      await prisma.serviceProvider.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app.close();
  });

  it("runs order creation through delivery completion and tracking", async () => {
    expect(customer).toBeDefined();
    expect(provider).toBeDefined();
    expect(vehicleId).toBeDefined();

    const createOrder = await app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: auth(customer!.accessToken),
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

    const matches = await app.inject({
      method: "GET",
      url: `/v1/orders/${orderId}/matches`,
      headers: auth(customer!.accessToken),
    });
    expect(matches.statusCode).toBe(200);
    expect(JSON.parse(matches.body).matches.some((match: { providerId: string }) => match.providerId === providerId)).toBe(true);

    const createOffer = await app.inject({
      method: "POST",
      url: `/v1/orders/${orderId}/offers`,
      headers: auth(provider!.accessToken),
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
      headers: auth(customer!.accessToken),
    });
    expect(offers.statusCode).toBe(200);
    expect(JSON.parse(offers.body).offers).toHaveLength(1);

    await prisma.serviceProvider.update({ where: { userId: providerId }, data: { isAvailable: false } });
    const staleAccept = await app.inject({
      method: "POST",
      url: `/v1/orders/${orderId}/offers/${offerId}/accept`,
      headers: auth(customer!.accessToken),
    });
    expect(staleAccept.statusCode).toBe(409);
    expect(JSON.parse(staleAccept.body).error).toBe("OFFER_NO_LONGER_ELIGIBLE");
    await prisma.serviceProvider.update({ where: { userId: providerId }, data: { isAvailable: true } });

    const accept = await app.inject({
      method: "POST",
      url: `/v1/orders/${orderId}/offers/${offerId}/accept`,
      headers: auth(customer!.accessToken),
    });
    expect(accept.statusCode).toBe(200);
    expect(JSON.parse(accept.body).order.status).toBe("DRIVER_ASSIGNED");
    expect(JSON.parse(accept.body).order.assignedDriverId).toBe(providerId);
    expect(JSON.parse(accept.body).order.vehicleId).toBe(vehicleId);

    const acceptanceEvent = await prisma.trackingEvent.findFirst({
      where: { orderId, eventType: "OFFER_ACCEPTED" },
    });
    expect(acceptanceEvent).not.toBeNull();
    expect(acceptanceEvent?.metadata).toMatchObject({ offerId, providerId, vehicleId });

    const preTrackingStatuses = ["EN_ROUTE_PICKUP", "ARRIVED_PICKUP", "LOADED", "IN_TRANSIT"];
    for (const status of preTrackingStatuses) {
      const transition = await app.inject({
        method: "POST",
        url: `/v1/orders/${orderId}/status`,
        headers: auth(provider!.accessToken),
        payload: { status },
      });
      expect(transition.statusCode, `transition to ${status}`).toBe(200);
      expect(JSON.parse(transition.body).order.status).toBe(status);
    }

    const gps = await app.inject({
      method: "POST",
      url: "/v1/tracking/location",
      headers: auth(provider!.accessToken),
      payload: {
        orderId,
        lat: 38.72,
        lng: 35.5,
        heading: 90,
        speedKph: 42,
        accuracyM: 8,
      },
    });
    expect(gps.statusCode).toBe(204);

    const tracking = await app.inject({
      method: "GET",
      url: `/v1/tracking/orders/${orderId}/location`,
      headers: auth(customer!.accessToken),
    });
    expect(tracking.statusCode).toBe(200);
    expect(JSON.parse(tracking.body).location.driverId).toBe(providerId);
    expect(JSON.parse(tracking.body).location.lat).toBe(38.72);

    for (const status of ["ARRIVED_DELIVERY", "DELIVERED"]) {
      const transition = await app.inject({
        method: "POST",
        url: `/v1/orders/${orderId}/status`,
        headers: auth(provider!.accessToken),
        payload: { status },
      });
      expect(transition.statusCode, `transition to ${status}`).toBe(200);
      expect(JSON.parse(transition.body).order.status).toBe(status);
    }

    const completionWithoutProof = await app.inject({
      method: "POST",
      url: `/v1/orders/${orderId}/status`,
      headers: auth(provider!.accessToken),
      payload: { status: "COMPLETED" },
    });
    expect(completionWithoutProof.statusCode).toBe(409);
    expect(JSON.parse(completionWithoutProof.body).error).toBe("DELIVERY_PROOF_REQUIRED");

    const proof = await app.inject({
      method: "POST",
      url: `/v1/tracking/orders/${orderId}/delivery-proof`,
      headers: auth(provider!.accessToken),
      payload: {
        type: "RECIPIENT_CONFIRMATION",
        recipientName: "E2E Recipient",
        note: "Delivery confirmed in E2E test",
      },
    });
    expect(proof.statusCode).toBe(201);
    expect(JSON.parse(proof.body).proof.eventType).toBe("DELIVERY_PROOF_SUBMITTED");

    const completion = await app.inject({
      method: "POST",
      url: `/v1/orders/${orderId}/status`,
      headers: auth(provider!.accessToken),
      payload: { status: "COMPLETED" },
    });
    expect(completion.statusCode).toBe(200);
    expect(JSON.parse(completion.body).order.status).toBe("COMPLETED");

    const inactiveTracking = await app.inject({
      method: "GET",
      url: `/v1/tracking/orders/${orderId}/location`,
      headers: auth(customer!.accessToken),
    });
    expect(inactiveTracking.statusCode).toBe(409);
    expect(JSON.parse(inactiveTracking.body).error).toBe("TRACKING_NOT_ACTIVE");
  });

  it("prevents concurrent orders from claiming the same provider and vehicle", async () => {
    expect(customer).toBeDefined();
    expect(provider).toBeDefined();
    expect(vehicleId).toBeDefined();

    const createOrder = async (label: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: auth(customer!.accessToken),
        payload: {
          serviceType: "Yük Taşımacılığı",
          pickupAddress: `Kayseri ${label}`,
          deliveryAddress: "Kayseri OSB",
          pickupLat: 38.6908,
          pickupLng: 35.5538,
          deliveryLat: 38.7569,
          deliveryLng: 35.4047,
          budgetMinor: "250000",
          currency: "TRY",
        },
      });
      expect(response.statusCode).toBe(201);
      const id = JSON.parse(response.body).order.id as string;
      contentionOrderIds.push(id);
      return id;
    };

    const [firstOrderId, secondOrderId] = await Promise.all([
      createOrder("Talas-1"),
      createOrder("Talas-2"),
    ]);

    const createOffer = async (targetOrderId: string, amountMinor: string) => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/orders/${targetOrderId}/offers`,
        headers: auth(provider!.accessToken),
        payload: { amountMinor, currency: "TRY", etaMinutes: 30 },
      });
      expect(response.statusCode).toBe(201);
      return JSON.parse(response.body).offer.id as string;
    };

    const [firstOfferId, secondOfferId] = await Promise.all([
      createOffer(firstOrderId, "210000"),
      createOffer(secondOrderId, "215000"),
    ]);

    const results = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/orders/${firstOrderId}/offers/${firstOfferId}/accept`,
        headers: auth(customer!.accessToken),
      }),
      app.inject({
        method: "POST",
        url: `/v1/orders/${secondOrderId}/offers/${secondOfferId}/accept`,
        headers: auth(customer!.accessToken),
      }),
    ]);

    const successCount = results.filter((result) => result.statusCode === 200).length;
    const conflictCount = results.filter((result) => result.statusCode === 409).length;
    expect(successCount).toBe(1);
    expect(conflictCount).toBe(1);

    const activeOrders = await prisma.order.findMany({
      where: {
        assignedDriverId: providerId,
        status: { in: ["DRIVER_ASSIGNED", "EN_ROUTE_PICKUP", "ARRIVED_PICKUP", "LOADED", "IN_TRANSIT", "ARRIVED_DELIVERY", "DELIVERED"] },
      },
      select: { id: true, vehicleId: true },
    });
    expect(activeOrders).toHaveLength(1);
    expect(activeOrders[0]?.vehicleId).toBe(vehicleId);

    const losingOrderId = results[0].statusCode === 200 ? secondOrderId : firstOrderId;
    const losingOrder = await prisma.order.findUnique({ where: { id: losingOrderId }, select: { status: true, assignedDriverId: true, vehicleId: true } });
    expect(losingOrder).toEqual({ status: "OFFERING", assignedDriverId: null, vehicleId: null });
  });
});