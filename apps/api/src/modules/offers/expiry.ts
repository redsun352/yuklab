import type { PrismaClient } from "@yuklab/database";
import { publishOrderStatus } from "../tracking/realtime";

/**
 * Expires stale pending offers and re-opens orders that have no remaining
 * pending offers. The update is idempotent, so it is safe to run from more
 * than one API instance.
 */
export async function expireOffers(prisma: PrismaClient, now = new Date()) {
  const expired = await prisma.offer.findMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    select: { id: true, orderId: true },
    take: 500,
  });

  if (expired.length === 0) return { offersExpired: 0, ordersReopened: 0 };

  const orderIds = [...new Set(expired.map((offer) => offer.orderId))];
  let offersExpired = 0;
  let ordersReopened = 0;

  for (const orderId of orderIds) {
    const result = await prisma.$transaction(async (tx) => {
      const updatedOffers = await tx.offer.updateMany({
        where: { orderId, status: "PENDING", expiresAt: { lte: now } },
        data: { status: "EXPIRED" },
      });

      if (updatedOffers.count === 0) return { offersExpired: 0, reopened: false };

      const pending = await tx.offer.count({ where: { orderId, status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } });
      if (pending > 0) return { offersExpired: updatedOffers.count, reopened: false };

      const reopened = await tx.order.updateMany({
        where: { id: orderId, status: "OFFERING" },
        data: { status: "PUBLISHED" },
      });

      await tx.auditLog.createMany({
        data: [
          ...expired.filter((offer) => offer.orderId === orderId).map((offer) => ({
            action: "OFFER_EXPIRED",
            entityType: "Offer",
            entityId: offer.id,
            metadata: { orderId },
          })),
          ...(reopened.count === 1 ? [{
            action: "ORDER_REOPENED_AFTER_OFFER_EXPIRY",
            entityType: "Order",
            entityId: orderId,
            metadata: { reason: "NO_PENDING_OFFERS" },
          }] : []),
        ],
      });

      return { offersExpired: updatedOffers.count, reopened: reopened.count === 1 };
    });

    offersExpired += result.offersExpired;
    if (result.reopened) {
      ordersReopened += 1;
      publishOrderStatus(orderId, "OFFERING", "PUBLISHED");
    }
  }

  return { offersExpired, ordersReopened };
}
