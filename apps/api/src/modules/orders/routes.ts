import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../auth/guard";
import type { Prisma } from "@yuklab/database";

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

const CURRENCY_RE = /^[A-Z]{3}$/;
const MAX_ADDRESS_LENGTH = 500;
const MAX_SERVICE_TYPE_LENGTH = 80;
const MAX_CURRENCY_LENGTH = 3;

export async function orderRoutes(app: FastifyInstance) {
  app.post<{ Body: OrderCreateBody }>(
    "/v1/orders",
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = request.body;
      const serviceType = body.serviceType?.trim();
      const pickupAddress = body.pickupAddress?.trim();
      const deliveryAddress = body.deliveryAddress?.trim();

      if (!serviceType || !pickupAddress || serviceType.length > MAX_SERVICE_TYPE_LENGTH || pickupAddress.length > MAX_ADDRESS_LENGTH || deliveryAddress && deliveryAddress.length > MAX_ADDRESS_LENGTH) {
        return reply.code(400).send({ error: "INVALID_INPUT" });
      }

      const coordinates = validateCoordinates(body);
      if (!coordinates.ok) return reply.code(400).send({ error: "INVALID_COORDINATES" });

      const budgetMinor = parseBudgetMinor(body.budgetMinor);
      if (body.budgetMinor !== undefined && budgetMinor === null) {
        return reply.code(400).send({ error: "INVALID_BUDGET" });
      }

      const currency = (body.currency ?? "TRY").trim().toUpperCase();
      if (currency.length !== MAX_CURRENCY_LENGTH || !CURRENCY_RE.test(currency)) {
        return reply.code(400).send({ error: "INVALID_CURRENCY" });
      }

      const urgency = Number(body.urgency ?? 0);
      if (!Number.isFinite(urgency)) return reply.code(400).send({ error: "INVALID_URGENCY" });
      const normalizedUrgency = Math.trunc(Math.max(0, Math.min(100, urgency)));

      let scheduledAt: Date | undefined;
      if (body.scheduledAt !== undefined) {
        scheduledAt = new Date(body.scheduledAt);
        if (!Number.isFinite(scheduledAt.getTime())) {
          return reply.code(400).send({ error: "INVALID_SCHEDULED_AT" });
        }
      }

      const order = await prisma.order.create({
        data: {
          customerId: request.user!.id,
          serviceType,
          pickupAddress,
          deliveryAddress: deliveryAddress || undefined,
          pickupLat: coordinates.pickupLat,
          pickupLng: coordinates.pickupLng,
          deliveryLat: coordinates.deliveryLat,
          deliveryLng: coordinates.deliveryLng,
          scheduledAt,
          budgetMinor: budgetMinor ?? undefined,
          currency,
          urgency: normalizedUrgency,
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

function parseBudgetMinor(value: string | number | undefined): bigint | null {
  if (value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return BigInt(value);
  }
  if (!/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function validateCoordinate(value: number | undefined, min: number, max: number): number | undefined | null {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

function validateCoordinates(body: OrderCreateBody): { ok: true; pickupLat?: number; pickupLng?: number; deliveryLat?: number; deliveryLng?: number } | { ok: false } {
  const pickupLat = validateCoordinate(body.pickupLat, -90, 90);
  const pickupLng = validateCoordinate(body.pickupLng, -180, 180);
  const deliveryLat = validateCoordinate(body.deliveryLat, -90, 90);
  const deliveryLng = validateCoordinate(body.deliveryLng, -180, 180);

  if (pickupLat === null || pickupLng === null || deliveryLat === null || deliveryLng === null) return { ok: false };
  if ((pickupLat === undefined) !== (pickupLng === undefined) || (deliveryLat === undefined) !== (deliveryLng === undefined)) return { ok: false };
  return { ok: true, pickupLat, pickupLng, deliveryLat, deliveryLng };
}

function serializeBigInt<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v))) as T;
}
