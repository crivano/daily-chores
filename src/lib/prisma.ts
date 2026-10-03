import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não configurada (use a string pooled do Neon).");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/**
 * Proxy lazy: o import do módulo nunca constrói o client (o build do Next
 * coleta dados de página sem segredos); a primeira consulta constrói.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    globalForPrisma.prisma ??= createPrisma();
    const client = globalForPrisma.prisma;
    const value = Reflect.get(client, prop, client) as unknown;
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});
