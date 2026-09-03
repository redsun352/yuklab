import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma";

export async function userRoutes(app: FastifyInstance) {
  app.get("/v1/users/me", async (_request, reply) => {
    return reply.code(501).send({
      error: "AUTH_NOT_IMPLEMENTED",
      message: "Authentication will be enabled in the next phase.",
    });
  });

  app.get("/v1/users/count", async () => {
    const count = await prisma.user.count();
    return { count };
  });
}
