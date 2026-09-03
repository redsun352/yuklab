import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { jwtVerify } from "jose";
import { prisma } from "../../lib/prisma";
import type { DriverLocation } from "./state";

const clients = new Map<string, Set<WebSocket>>();

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

export function publishOrderLocation(orderId: string, location: DriverLocation): void {
  const group = clients.get(orderId);
  if (!group) return;
  const payload = JSON.stringify({ type: "driver.location", orderId, location });
  for (const socket of group) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}

export async function trackingRealtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { orderId: string } }>(
    "/v1/tracking/orders/:orderId/ws",
    { websocket: true },
    async (socket, request) => {
      let userId: string;
      try {
        const auth = request.headers.authorization;
        if (!auth?.startsWith("Bearer ")) throw new Error("missing auth");
        const { payload } = await jwtVerify(auth.slice(7), jwtSecret());
        if (!payload.sub) throw new Error("missing subject");
        userId = payload.sub;
      } catch {
        socket.close(1008, "UNAUTHORIZED");
        return;
      }

      const order = await prisma.order.findFirst({
        where: {
          id: request.params.orderId,
          OR: [{ customerId: userId }, { assignedDriverId: userId }],
        },
        select: { id: true, assignedDriverId: true },
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
