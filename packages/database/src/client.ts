import { PrismaClient } from "@prisma/client";

export { PrismaClient } from "@prisma/client";
export type { Prisma } from "@prisma/client";

export const prisma = new PrismaClient();

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
