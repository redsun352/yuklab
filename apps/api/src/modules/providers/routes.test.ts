import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../server";
import { prisma } from "../../lib/prisma";

const app = buildApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `provider-profile-${suffix}@example.com`;
const password = "YukLab-Provider-Profile-2026!";
let userId: string | undefined;
let token: string | undefined;

describe("provider profile API", () => {
  beforeAll(async () => {
    const register = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, firstName: "Profile", lastName: "Provider", password, preferredLanguage: "tr-TR" },
    });
    expect(register.statusCode).toBe(201);

    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { identifier: email, password } });
    expect(login.statusCode).toBe(200);
    const body = JSON.parse(login.body) as { accessToken: string; user: { id: string } };
    token = body.accessToken;
    userId = body.user.id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.serviceProvider.deleteMany({ where: { userId } });
      await prisma.driverProfile.deleteMany({ where: { userId } });
      await prisma.authSession.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await app.close();
  });

  it("onboards a customer as a service provider and persists category", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/become-provider",
      headers: { authorization: `Bearer ${token}` },
      payload: { providerType: "SERVICE_PROVIDER", category: "TOWING" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { user: { role: string }; provider: { type: string; category: string } };
    expect(body.user.role).toBe("SERVICE_PROVIDER");
    expect(body.provider.type).toBe("SERVICE_PROVIDER");
    expect(body.provider.category).toBe("TOWING");
  });

  it("updates service-provider availability and radius", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/providers/me",
      headers: { authorization: `Bearer ${token}` },
      payload: { isAvailable: true, serviceRadiusKm: 75, category: "ROADSIDE_ASSISTANCE" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { provider: { isOnline: boolean; isAvailable: boolean; serviceRadiusKm: number; category: string } };
    expect(body.provider.isOnline).toBe(true);
    expect(body.provider.isAvailable).toBe(true);
    expect(body.provider.serviceRadiusKm).toBe(75);
    expect(body.provider.category).toBe("ROADSIDE_ASSISTANCE");
  });
});
