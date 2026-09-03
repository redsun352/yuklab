import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { userRoutes } from "./routes/users";
import { authRoutes } from "./modules/auth/routes";
import { orderRoutes } from "./modules/orders/routes";
import { offerRoutes } from "./modules/offers/routes";
import { matchingRoutes } from "./modules/matching/routes";
import { trackingRoutes } from "./modules/tracking/routes";
import { trackingRealtimeRoutes } from "./modules/tracking/realtime";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(websocket);
  app.get("/health", async () => ({ status: "ok", service: "yuklab-api", version: "0.1.0" }));
  app.register(authRoutes);
  app.register(userRoutes);
  app.register(orderRoutes);
  app.register(offerRoutes);
  app.register(matchingRoutes);
  app.register(trackingRoutes);
  app.register(trackingRealtimeRoutes);

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
