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
import { matchingRoutes } from "./modules/matching/routes";
import { trackingRoutes } from "./modules/tracking/routes";
import { trackingRealtimeRoutes } from "./modules/tracking/realtime";
import { trackingWsTokenRoutes } from "./modules/tracking/ws-token";
import { vehicleRoutes } from "./modules/vehicles/routes";
import { routingRoutes } from "./modules/routing/routes";

export function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
  const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.register(cors, {
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
    credentials: true,
  });
  app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
  });
  app.register(websocket);
  app.get("/health", async () => ({ status: "ok", service: "yuklab-api", version: "0.1.0" }));
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
  app.register(routingRoutes);

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? "0.0.0.0";
  app.listen({ port, host }).catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}
