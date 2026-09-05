import type { PrismaClient, OrderStatus, UserRole } from "@yuklab/database";
import { publishOrderStatus } from "../tracking/realtime";

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  DRAFT: ["PUBLISHED", "CANCELLED"],
  PUBLISHED: ["OFFERING", "ACCEPTED", "CANCELLED", "EXPIRED"],
  OFFERING: ["ACCEPTED", "CANCELLED", "EXPIRED"],
  ACCEPTED: ["DRIVER_ASSIGNED", "CANCELLED"],
  DRIVER_ASSIGNED: ["EN_ROUTE_PICKUP", "CANCELLED"],
  EN_ROUTE_PICKUP: ["ARRIVED_PICKUP", "CANCELLED"],
  ARRIVED_PICKUP: ["LOADED", "CANCELLED"],
  LOADED: ["IN_TRANSIT"],
  IN_TRANSIT: ["ARRIVED_DELIVERY"],
  ARRIVED_DELIVERY: ["DELIVERED"],
  DELIVERED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
  FAILED: [],
  DISPUTED: [],
};

const PROVIDER_STATUSES = new Set<OrderStatus>([
  "DRIVER_ASSIGNED",
  "EN_ROUTE_PICKUP",
  "ARRIVED_PICKUP",
  "LOADED",
  "IN_TRANSIT",
  "ARRIVED_DELIVERY",
  "DELIVERED",
  "COMPLETED",
]);

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function canActorTransition(
  role: UserRole,
  actorId: string,
  customerId: string,
  assignedDriverId: string | null,
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  if (!canTransition(from, to)) return false;
  if (role === "ADMIN" || role === "SUPER_ADMIN") return true;
  if (to === "CANCELLED") return actorId === customerId || actorId === assignedDriverId;
  if (PROVIDER_STATUSES.has(to)) {
    return actorId === assignedDriverId && (role === "DRIVER" || role === "SERVICE_PROVIDER");
  }
  return false;
}

export async function transitionOrder(
  prisma: PrismaClient,
  input: {
    orderId: string;
    actorId: string;
    actorRole: UserRole;
    to: OrderStatus;
    metadata?: Record<string, unknown>;
  },
) {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: { id: true, customerId: true, assignedDriverId: true, vehicleId: true, status: true },
    });
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (!canActorTransition(input.actorRole, input.actorId, order.customerId, order.assignedDriverId, order.status, input.to)) {
      throw new Error("INVALID_ORDER_TRANSITION");
    }

    const updated = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: input.to === "CANCELLED"
        ? { status: input.to, assignedDriverId: null, vehicleId: null }
        : { status: input.to },
    });
    if (updated.count !== 1) throw new Error("ORDER_STATE_RACE");

    await tx.trackingEvent.create({
      data: {
        orderId: order.id,
        actorId: input.actorId,
        eventType: `ORDER_STATUS_${input.to}`,
        metadata: {
          from: order.status,
          to: input.to,
          ...(input.to === "CANCELLED" ? { releasedDriverId: order.assignedDriverId, releasedVehicleId: order.vehicleId } : {}),
          ...(input.metadata ?? {}),
        },
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "ORDER_STATUS_CHANGED",
        entityType: "Order",
        entityId: order.id,
        metadata: {
          from: order.status,
          to: input.to,
          ...(input.to === "CANCELLED" ? { releasedDriverId: order.assignedDriverId, releasedVehicleId: order.vehicleId } : {}),
        },
      },
    });
    return { order: { ...order, status: input.to, ...(input.to === "CANCELLED" ? { assignedDriverId: null, vehicleId: null } : {}) }, from: order.status };
  });

  publishOrderStatus(input.orderId, result.from, result.order.status);
  return result.order;
}
