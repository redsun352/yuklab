import type { PrismaClient } from "@yuklab/database";

export const DELIVERY_PROOF_TYPES = ["PHOTO", "SIGNATURE", "RECIPIENT_CONFIRMATION", "OTHER"] as const;
export type DeliveryProofType = (typeof DELIVERY_PROOF_TYPES)[number];

export type DeliveryProofInput = {
  orderId: string;
  actorId: string;
  type: DeliveryProofType;
  fileUrl?: string;
  recipientName?: string;
  note?: string;
};

export async function submitDeliveryProof(prisma: PrismaClient, input: DeliveryProofInput) {
  if (!input.fileUrl && !input.recipientName && !input.note) throw new Error("PROOF_DATA_REQUIRED");

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: { id: true, status: true, assignedDriverId: true },
    });
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (order.assignedDriverId !== input.actorId) throw new Error("NOT_ASSIGNED_PROVIDER");
    if (order.status !== "ARRIVED_DELIVERY" && order.status !== "DELIVERED") throw new Error("INVALID_PROOF_STATE");

    const event = await tx.trackingEvent.create({
      data: {
        orderId: order.id,
        actorId: input.actorId,
        eventType: "DELIVERY_PROOF_SUBMITTED",
        metadata: {
          type: input.type,
          ...(input.fileUrl ? { fileUrl: input.fileUrl } : {}),
          ...(input.recipientName ? { recipientName: input.recipientName } : {}),
          ...(input.note ? { note: input.note } : {}),
        },
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "DELIVERY_PROOF_SUBMITTED",
        entityType: "Order",
        entityId: order.id,
        metadata: { type: input.type, trackingEventId: event.id },
      },
    });
    return event;
  });
}

export async function hasDeliveryProof(prisma: PrismaClient, orderId: string) {
  const proof = await prisma.trackingEvent.findFirst({
    where: { orderId, eventType: "DELIVERY_PROOF_SUBMITTED" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  return Boolean(proof);
}
