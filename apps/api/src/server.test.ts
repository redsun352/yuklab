import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./server";

describe("API server", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCorsOrigin = process.env.CORS_ORIGIN;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = originalCorsOrigin;
  });

  it("exposes a health endpoint with baseline security headers", async () => {
    process.env.NODE_ENV = "test";
    process.env.CORS_ORIGIN = "http://localhost:3000";
    const app = buildApp();

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "yuklab-api", version: "0.1.0" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["permissions-policy"]).toContain("geolocation=(self)");

    await app.close();
  });

  it("rejects wildcard CORS when credentials are enabled", () => {
    process.env.NODE_ENV = "test";
    process.env.CORS_ORIGIN = "*";

    expect(() => buildApp()).toThrow("CORS_ORIGIN must not contain '*'");
  });
});
