import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import Redis from "ioredis";
import { jwtVerify } from "jose";
import { prisma } from "../../lib/prisma";
import type { DriverLocation } from "./state";

const clients = new Map<string, Set<WebSocket>>();
const channel = "yuklab:tracking:locations";
const redisUrl = process.env.REDIS_URL;
let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let subscriberStarted = false;

function jwtSecret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error("JWT_SECRET must be at least 32 characters long");
  return new TextEncoder().encode(value);
}

function addClient(orderId: string, socket: WebSocket): void {
  const group = clients.get(orderId) ?? new Set<WebSocket>();
  group.add(socket);
  clients.set(orderId, group);
}

function removeClient(orderId: string, socket: WebSocket): void {
  const group = clients.get(orderId);
  if (!group) return;
  group.delete(socket);
  if (group.size === 0) clients.delete(orderId);
}

function fanout(orderId: string, message: string): void {
  const group = clients.get(orderId);
  if (!group) return;
  for (const socket of group) if (socket.readyState === WebSocket.OPEN) socket.send(message);
}

function publishRedis(orderId: string, event: Record<string, unknown>): void {
  const message = JSON.stringify(event);
  if (!redisUrl) {
    fanout(orderId, message);
    return;
  }
  if (!publisher) {
    publisher = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    publisher.on("error", () => undefined);
  }
  void publisher.publish(channel, message).catch(() => fanout(orderId, message));
}

async function startSubscriber(): Promise<void> {
  if (!redisUrl || subscriberStarted) return;
  subscriberStarted = true;
  subscriber = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  subscriber.on("error", () => undefined);
  try {
    await subscriber.connect();
    await subscriber.subscribe(channel);
    subscriber.on("message", (_channel, message) => {
      try {
        const event = JSON.parse(message) as { orderId?: string };
        if (event.orderId) fanout(event.orderId, message);
      } catch {
        // Ignore malformed pub/sub messages.
      }
    });
  } catch {
    subscriberStarted = false;
    await subscriber.quit().catch(() => undefined);
    subscriber = null;
  }
}

export function publishOrderLocation(orderId: string, location: DriverLocation): void {
  publishRedis(orderId, { type: "driver.location", orderId, location });
}

export function publishOrderStatus(orderId: string, from: string, to: string): void {
  publishRedis(orderId, { type: "order.status", orderId, from, status: to, timestamp: new Date().toISOString() });
}

export function publishOrderOffer(orderId: string, offer: { id: string; providerId: string; amountMinor: bigint; currency: string; etaMinutes: number | null; note: string | null; expiresAt: Date | null }): void {
  publishRedis(orderId, {
    type: "order.offer",
    orderId,
    offer: {
      ...offer,
      amountMinor: offer.amountMinor.toString(),
      expiresAt: offer.expiresAt?.toISOString() ?? null,
    },
    timestamp: new Date().toISOString(),
  });
}

export async function trackingRealtimeRoutes(app: FastifyInstance): Promise<void> {
  await startSubscriber();
  app.get<{ Params: { orderId: string } }>(
    "/v1/tracking/orders/:orderId/ws",
    { websocket: true },
    async (socket, request) => {
      let userId: string;
      let tokenOrderId: string;
      try {
        const protocols = request.headers["sec-websocket-protocol"];
        const values = Array.isArray(protocols) ? protocols : protocols?.split(",").map((value) => value.trim());
        const token = values?.find((value) => value.startsWith("yuklab-token."))?.slice("yuklab-token.".length);
        if (!token) throw new Error("missing ws token");
        const { payload } = await jwtVerify(token, jwtSecret());
        if (payload.typ !== "tracking-ws" || typeof payload.ord !== "string" || !payload.sub) throw new Error("invalid ws token");
        userId = payload.sub;
        tokenOrderId = payload.ord;
      } catch {
        socket.close(1008, "UNAUTHORIZED");
        return;
      }

      if (tokenOrderId !== request.params.orderId) {
        socket.close(1008, "INVALID_ORDER");
        return;
      }
      const order = await prisma.order.findFirst({
        where: { id: request.params.orderId, OR: [{ customerId: userId }, { assignedDriverId: userId }] },
        select: { id: true },
      });
      if (!order) {
        socket.close(1008, "ORDER_NOT_FOUND");
        return;
      }

      addClient(order.id, socket);
      socket.send(JSON.stringify({ type: "tracking.connected", orderId: order.id }));
      socket.on("close", () => removeClient(order.id, socket));
      socket.on("error", () => removeClient(order.id, socket));
    },
  );
}
