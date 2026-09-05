import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import rateLimit from "@fastify/rate-limit";
import { userRoutes } from "./routes/users";
import { authRoutes } from "./modules/auth/routes";
import { orderRoutes } from "./modules/orders/routes";
import { orderTransitionRoutes } from "./modules/orders/transition-routes";
import { providerOrderRoutes } from "./modules/orders/provider-routes";
import { offerRoutes } from "./modules/offers/routes";
import { expireOffers } from "./modules/offers/expiry";
import { matchingRoutes } from "./modules/matching/routes";
import { trackingRoutes } from "./modules/tracking/routes";
import { trackingRealtimeRoutes } from "./modules/tracking/realtime";
import { trackingWsTokenRoutes } from "./modules/tracking/ws-token";
import { vehicleRoutes } from "./modules/vehicles/routes";
import { providerRoutes } from "./modules/providers/routes";
import { routingRoutes } from "./modules/routing/routes";
import { prisma } from "./lib/prisma";

export function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
  const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowedOrigins.some((origin) => origin === "*")) {
    throw new Error("CORS_ORIGIN must not contain '*' when credentials are enabled");
  }

  app.register(cors, {
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
    credentials: true,
  });
  app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
  });
  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
    if (process.env.NODE_ENV === "production") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });
  app.register(websocket);
  app.get("/health", async () => ({ status: "ok", service: "yuklab-api", version: "0.1.0" }));
  app.get("/ready", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ready", service: "yuklab-api" };
    } catch {
      return reply.code(503).send({ status: "not_ready", service: "yuklab-api" });
    }
  });
  app.register(authRoutes);
  app.register(userRoutes);
  app.register(orderRoutes);
  app.register(orderTransitionRoutes);
  app.register(providerOrderRoutes);
  app.register(offerRoutes);
  app.register(matchingRoutes);
  app.register(trackingRoutes);
  app.register(trackingWsTokenRoutes);
  app.register(trackingRealtimeRoutes);
  app.register(vehicleRoutes);
  app.register(providerRoutes);
  app.register(routingRoutes);

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? "0.0.0.0";
  const expiryInterval = setInterval(() => {
    void expireOffers(prisma).catch((error) => app.log.error(error, "offer expiry maintenance failed"));
  }, 30_000);
  expiryInterval.unref();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    clearInterval(expiryInterval);
    try {
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    } catch (error) {
      app.log.error(error, "graceful shutdown failed");
      process.exit(1);
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  app.listen({ port, host }).catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}
