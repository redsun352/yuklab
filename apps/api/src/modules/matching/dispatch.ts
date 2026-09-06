import type { PrismaClient } from "@yuklab/database";
import { findMatches } from "./engine";

const DEFAULT_DISPATCH_LIMIT = 20;
const MAX_DISPATCH_LIMIT = 50;

export type DispatchResult = {
  orderId: string;
  dispatchedProviderIds: string[];
  count: number;
};

/**
 * Recomputes the authoritative match set and records an idempotent dispatch
 * event for each eligible provider. Providers still choose their own price;
 * dispatch never creates an offer on their behalf.
 */
export async function dispatchOrderMatches(
  prisma: PrismaClient,
  orderId: string,
  limit = DEFAULT_DISPATCH_LIMIT,
): Promise<DispatchResult> {
  const safeLimit = Math.min(MAX_DISPATCH_LIMIT, Math.max(1, Math.trunc(limit)));
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
  if (!order || !["PUBLISHED", "OFFERING"].includes(order.status)) {
    return { orderId, dispatchedProviderIds: [], count: 0 };
  }

  const matches = (await findMatches(prisma, orderId)).slice(0, safeLimit);
  if (matches.length === 0) return { orderId, dispatchedProviderIds: [], count: 0 };

  const dispatchedProviderIds: string[] = [];
  for (const match of matches) {
    const existing = await prisma.auditLog.findFirst({
      where: {
        action: "MATCH_DISPATCHED",
        entityType: "Order",
        entityId: orderId,
        metadata: { path: ["providerId"], equals: match.providerId },
      },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.$transaction(async (tx) => {
      const duplicate = await tx.auditLog.findFirst({
        where: {
          action: "MATCH_DISPATCHED",
          entityType: "Order",
          entityId: orderId,
          metadata: { path: ["providerId"], equals: match.providerId },
        },
        select: { id: true },
      });
      if (duplicate) return;

      await tx.trackingEvent.create({
        data: {
          orderId,
          actorId: match.providerId,
          eventType: "MATCH_DISPATCHED",
          metadata: {
            providerId: match.providerId,
            providerRole: match.providerRole,
            score: match.score,
            distanceKm: match.distanceKm,
            etaMinutes: match.etaMinutes,
            vehicleId: match.vehicleId,
            vehicleType: match.vehicleType,
            vehicleSubtype: match.vehicleSubtype,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: match.providerId,
          action: "MATCH_DISPATCHED",
          entityType: "Order",
          entityId: orderId,
          metadata: {
            providerId: match.providerId,
            providerRole: match.providerRole,
            score: match.score,
            distanceKm: match.distanceKm,
            etaMinutes: match.etaMinutes,
            vehicleId: match.vehicleId,
          },
        },
      });
    });
    dispatchedProviderIds.push(match.providerId);
  }

  return { orderId, dispatchedProviderIds, count: dispatchedProviderIds.length };
}
