import type { FastifyInstance } from "fastify";
import { OrderStatus } from "@yuklab/database";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../auth/guard";
import { transitionOrder } from "./transitions";

const TRANSITION_TARGETS = new Set<string>(Object.values(OrderStatus));

type TransitionBody = {
  status: string;
  metadata?: Record<string, unknown>;
};

export async function orderTransitionRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: TransitionBody }>(
    "/v1/orders/:id/status",
    { preHandler: requireAuth },
    async (request, reply) => {
      const target = request.body?.status;
      if (typeof target !== "string" || !TRANSITION_TARGETS.has(target)) {
        return reply.code(400).send({ error: "INVALID_STATUS" });
      }

      try {
        const result = await transitionOrder(prisma, {
          orderId: request.params.id,
          actorId: request.user!.id,
          actorRole: request.user!.role,
          to: target as OrderStatus,
          metadata: request.body?.metadata,
        });
        return { order: result };
      } catch (error) {
        const code = error instanceof Error ? error.message : "ORDER_TRANSITION_FAILED";
        if (code === "ORDER_NOT_FOUND") {
          return reply.code(404).send({ error: code });
        }
        if (code === "INVALID_ORDER_TRANSITION") {
          return reply.code(409).send({ error: code });
        }
        if (code === "ORDER_STATE_RACE") {
          return reply.code(409).send({ error: code });
        }
        request.log.error(error);
        return reply.code(500).send({ error: "ORDER_TRANSITION_FAILED" });
      }
    },
  );
}
