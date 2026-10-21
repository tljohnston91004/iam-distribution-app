import { PrismaClient } from "@prisma/client";
import { resolveBoundLegacyCompany } from "./dpos/company-context";
import { DposConfigError, loadDposIntegrationConfig } from "./dpos/config";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * STANDALONE_LEGACY (default): V1.5 behaviour — the first company, or a "Pilot Distributor" created on first use.
 * DPOS_INTEGRATED: the ONE company bound to this installation by the governed company binding. There is no silent
 * default: a missing, mismatched or suspended binding throws (and a service-level caller reports it).
 */
export async function ensureDefaultCompany() {
  const loaded = loadDposIntegrationConfig(process.env);
  if (!loaded.ok) throw new DposConfigError(loaded.issues);
  if (loaded.config.mode === "DPOS_INTEGRATED") {
    return resolveBoundLegacyCompany(prisma, loaded.config);
  }

  const existing = await prisma.company.findFirst();
  if (existing) return existing;

  return prisma.company.create({
    data: {
      name: "Pilot Distributor",
    },
  });
}
