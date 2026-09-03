import Fastify from "fastify";
import { userRoutes } from "./routes/users";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({
    status: "ok",
    service: "yuklab-api",
    version: "0.1.0",
  }));

  app.register(userRoutes);

  return app;
}

const app = buildApp();
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
