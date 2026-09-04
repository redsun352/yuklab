import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../auth/guard";
import type { Prisma } from "@yuklab/database";

const ORDER_STATUSES = ["DRAFT", "PUBLISHED", "OFFERING"] as const;

type OrderCreateBody = {
  serviceType: string;
  pickupAddress: string;
  deliveryAddress?: string;
  pickupLat?: number;
  pickupLng?: number;
  deliveryLat?: number;
  deliveryLng?: number;
  scheduledAt?: string;
  budgetMinor?: string | number;
  currency?: string;
  urgency?: number;
  payload?: Prisma.InputJsonValue;
};

export async function orderRoutes(app: FastifyInstance) {
  app.post<{ Body: OrderCreateBody }>(
    "/v1/orders",
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = request.body;
      if (!body.serviceType?.trim() || !body.pickupAddress?.trim()) {
        return reply.code(400).send({ error: "INVALID_INPUT" });
      }

      const urgency = Math.max(0, Math.min(100, Math.trunc(body.urgency ?? 0)));
      const budgetMinor = body.budgetMinor === undefined ? undefined : BigInt(body.budgetMinor);

      const order = await prisma.order.create({
        data: {
          customerId: request.user!.id,
          serviceType: body.serviceType.trim(),
          pickupAddress: body.pickupAddress.trim(),
          deliveryAddress: body.deliveryAddress?.trim(),
          pickupLat: body.pickupLat,
          pickupLng: body.pickupLng,
          deliveryLat: body.deliveryLat,
          deliveryLng: body.deliveryLng,
          scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
          budgetMinor,
          currency: body.currency ?? "TRY",
          urgency,
          payload: body.payload,
          status: "PUBLISHED",
        },
        select: {
          id: true,
          serviceType: true,
          status: true,
          pickupAddress: true,
          deliveryAddress: true,
          pickupLat: true,
          pickupLng: true,
          deliveryLat: true,
          deliveryLng: true,
          scheduledAt: true,
          budgetMinor: true,
          currency: true,
          urgency: true,
          createdAt: true,
        },
      });

      return reply.code(201).send({ order: serializeBigInt(order) });
    },
  );

  app.get("/v1/orders", { preHandler: requireAuth }, async (request) => {
    const orders = await prisma.order.findMany({
      where: { customerId: request.user!.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        assignedDriverId: true,
        serviceType: true,
        status: true,
        pickupAddress: true,
        deliveryAddress: true,
        pickupLat: true,
        pickupLng: true,
        deliveryLat: true,
        deliveryLng: true,
        scheduledAt: true,
        budgetMinor: true,
        currency: true,
        urgency: true,
        payload: true,
        createdAt: true,
      },
    });

    return { orders: orders.map(serializeBigInt) };
  });

  app.get<{ Params: { id: string } }>(
    "/v1/orders/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const order = await prisma.order.findFirst({
        where: { id: request.params.id, customerId: request.user!.id },
      });

      if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      return { order: serializeBigInt(order) };
    },
  );
}

function serializeBigInt<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v))) as T;
}

void ORDER_STATUSES;
