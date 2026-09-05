import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma";
import { requireRole } from "../auth/guard";

const MAX_CATEGORY_LENGTH = 80;

function decimalToNumber(value: unknown): number {
  return typeof value === "object" && value !== null && "toString" in value ? Number(value.toString()) : Number(value);
}

function serializeProfile(profile: {
  userId: string;
  category?: string | null;
  isOnline: boolean;
  isAvailable: boolean;
  rating: unknown;
  completedJobs: number;
  cancellationRate: unknown;
  reliabilityScore: unknown;
  serviceRadiusKm: unknown;
}) {
  return {
    userId: profile.userId,
    category: profile.category ?? null,
    isOnline: profile.isOnline,
    isAvailable: profile.isAvailable,
    rating: decimalToNumber(profile.rating),
    completedJobs: profile.completedJobs,
    cancellationRate: decimalToNumber(profile.cancellationRate),
    reliabilityScore: decimalToNumber(profile.reliabilityScore),
    serviceRadiusKm: decimalToNumber(profile.serviceRadiusKm),
  };
}

export async function providerRoutes(app: FastifyInstance) {
  app.get("/v1/providers/me", { preHandler: requireRole("DRIVER", "SERVICE_PROVIDER") }, async (request, reply) => {
    const role = request.user!.role;
    if (role === "SERVICE_PROVIDER") {
      const profile = await prisma.serviceProvider.findUnique({ where: { userId: request.user!.id } });
      if (!profile) return reply.code(404).send({ error: "PROVIDER_PROFILE_NOT_FOUND" });
      return { provider: serializeProfile(profile) };
    }

    const profile = await prisma.driverProfile.findUnique({ where: { userId: request.user!.id } });
    if (!profile) return reply.code(404).send({ error: "PROVIDER_PROFILE_NOT_FOUND" });
    return { provider: serializeProfile(profile) };
  });

  app.patch("/v1/providers/me", { preHandler: requireRole("DRIVER", "SERVICE_PROVIDER") }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const data: { isOnline?: boolean; isAvailable?: boolean; serviceRadiusKm?: number; category?: string } = {};

    if (body.isOnline !== undefined) {
      if (typeof body.isOnline !== "boolean") return reply.code(400).send({ error: "INVALID_IS_ONLINE" });
      data.isOnline = body.isOnline;
      if (!body.isOnline) data.isAvailable = false;
    }
    if (body.isAvailable !== undefined) {
      if (typeof body.isAvailable !== "boolean") return reply.code(400).send({ error: "INVALID_IS_AVAILABLE" });
      data.isAvailable = body.isAvailable;
    }
    if (body.serviceRadiusKm !== undefined) {
      const radius = Number(body.serviceRadiusKm);
      if (!Number.isFinite(radius) || radius < 1 || radius > 500) return reply.code(400).send({ error: "INVALID_SERVICE_RADIUS" });
      data.serviceRadiusKm = radius;
    }
    if (body.category !== undefined) {
      if (request.user!.role !== "SERVICE_PROVIDER") return reply.code(400).send({ error: "CATEGORY_ONLY_FOR_SERVICE_PROVIDER" });
      if (typeof body.category !== "string") return reply.code(400).send({ error: "INVALID_CATEGORY" });
      const category = body.category.trim();
      if (!category || category.length > MAX_CATEGORY_LENGTH) return reply.code(400).send({ error: "INVALID_CATEGORY" });
      data.category = category;
    }

    if (data.isAvailable === true && data.isOnline !== false) data.isOnline = true;

    if (request.user!.role === "SERVICE_PROVIDER") {
      const profile = await prisma.serviceProvider.updateMany({ where: { userId: request.user!.id }, data });
      if (profile.count === 0) return reply.code(404).send({ error: "PROVIDER_PROFILE_NOT_FOUND" });
      const updated = await prisma.serviceProvider.findUniqueOrThrow({ where: { userId: request.user!.id } });
      return { provider: serializeProfile(updated) };
    }

    const profile = await prisma.driverProfile.updateMany({ where: { userId: request.user!.id }, data: { isOnline: data.isOnline, isAvailable: data.isAvailable, serviceRadiusKm: data.serviceRadiusKm } });
    if (profile.count === 0) return reply.code(404).send({ error: "PROVIDER_PROFILE_NOT_FOUND" });
    const updated = await prisma.driverProfile.findUniqueOrThrow({ where: { userId: request.user!.id } });
    return { provider: serializeProfile(updated) };
  });
}
