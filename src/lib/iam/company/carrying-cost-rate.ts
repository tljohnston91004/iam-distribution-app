/**
 * Company annual inventory carrying-cost rate configuration (server).
 * Per-company only — never invent a universal hard-coded rate in COI/UI.
 */

import { prisma } from "@/lib/db";
import {
  CARRYING_COST_RATE_FIELD,
  CARRYING_COST_RATE_PERMISSION,
  CARRYING_COST_RATE_SOURCES,
  MAX_ANNUAL_CARRYING_COST_RATE,
  decimalToPercent,
  isAuthorizedToEditCarryingCostRate,
  validateCarryingCostRateDecimal,
  type CarryingCostRateSource,
} from "./carrying-cost-rate-shared";

export * from "./carrying-cost-rate-shared";

export type CarryingCostRateConfig = {
  companyId: string;
  companyName: string;
  annualCarryingCostRate: number | null;
  /** User-facing percentage (e.g. 24 for 24%). */
  displayPercent: number | null;
  effectiveDate: string | null;
  source: string | null;
  configurationNote: string | null;
  requiredPermission: string;
  lastUpdatedBy: string | null;
  lastUpdatedAt: string | null;
  maxAllowedRate: number;
};

export type CarryingCostRateHistoryEntry = {
  id: string;
  performedBy: string;
  performedAt: string;
  beforeJson: string | null;
  afterJson: string | null;
  detail: string | null;
};

function toConfig(company: {
  id: string;
  name: string;
  annualCarryingCostRate: number | null;
  carryingCostRateEffectiveDate: Date | null;
  carryingCostRateSource: string | null;
  carryingCostRateNote: string | null;
  carryingCostRatePermission: string | null;
  carryingCostRateUpdatedBy: string | null;
  carryingCostRateUpdatedAt: Date | null;
  carryingCostRateMaxAllowed: number | null;
}): CarryingCostRateConfig {
  const rate = company.annualCarryingCostRate;
  return {
    companyId: company.id,
    companyName: company.name,
    annualCarryingCostRate: rate,
    displayPercent: rate != null ? decimalToPercent(rate) : null,
    effectiveDate: company.carryingCostRateEffectiveDate?.toISOString().slice(0, 10) ?? null,
    source: company.carryingCostRateSource,
    configurationNote: company.carryingCostRateNote,
    requiredPermission: company.carryingCostRatePermission ?? CARRYING_COST_RATE_PERMISSION,
    lastUpdatedBy: company.carryingCostRateUpdatedBy,
    lastUpdatedAt: company.carryingCostRateUpdatedAt?.toISOString() ?? null,
    maxAllowedRate: company.carryingCostRateMaxAllowed ?? MAX_ANNUAL_CARRYING_COST_RATE,
  };
}

export async function getCompanyCarryingCostRate(companyId: string): Promise<CarryingCostRateConfig> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  return toConfig(company);
}

export async function listCarryingCostRateHistory(
  companyId: string,
  take = 25
): Promise<CarryingCostRateHistoryEntry[]> {
  const rows = await prisma.companyConfigurationChange.findMany({
    where: { companyId, fieldKey: CARRYING_COST_RATE_FIELD },
    orderBy: { performedAt: "desc" },
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    performedBy: r.performedBy,
    performedAt: r.performedAt.toISOString(),
    beforeJson: r.beforeJson,
    afterJson: r.afterJson,
    detail: r.detail,
  }));
}

export async function setCompanyCarryingCostRate(input: {
  companyId: string;
  annualCarryingCostRate: number;
  source: CarryingCostRateSource;
  configurationNote?: string | null;
  effectiveDate?: Date | string | null;
  performedBy: string;
  iamRunId?: string | null;
}): Promise<CarryingCostRateConfig> {
  if (!isAuthorizedToEditCarryingCostRate(input.performedBy)) {
    throw new Error(
      `Permission denied: updating Annual Inventory Carrying-Cost Rate requires ${CARRYING_COST_RATE_PERMISSION} (executive or operations)`
    );
  }
  if (!CARRYING_COST_RATE_SOURCES.includes(input.source)) {
    throw new Error(`Invalid source. Allowed: ${CARRYING_COST_RATE_SOURCES.join(", ")}`);
  }

  const beforeCompany = await prisma.company.findUniqueOrThrow({ where: { id: input.companyId } });
  const maxAllowed = beforeCompany.carryingCostRateMaxAllowed ?? MAX_ANNUAL_CARRYING_COST_RATE;
  const check = validateCarryingCostRateDecimal(input.annualCarryingCostRate, maxAllowed);
  if (!check.ok) throw new Error(check.error);

  const effectiveDate = input.effectiveDate ? new Date(input.effectiveDate) : new Date();
  const updatedAt = new Date();
  const before = toConfig(beforeCompany);

  const company = await prisma.company.update({
    where: { id: input.companyId },
    data: {
      annualCarryingCostRate: input.annualCarryingCostRate,
      carryingCostRateEffectiveDate: effectiveDate,
      carryingCostRateSource: input.source,
      carryingCostRateNote: input.configurationNote?.trim() || null,
      carryingCostRatePermission: CARRYING_COST_RATE_PERMISSION,
      carryingCostRateUpdatedBy: input.performedBy,
      carryingCostRateUpdatedAt: updatedAt,
    },
  });

  const after = toConfig(company);
  const detail = `rate ${before.displayPercent ?? "null"}% → ${after.displayPercent}% (${input.source})`;

  await prisma.companyConfigurationChange.create({
    data: {
      companyId: input.companyId,
      fieldKey: CARRYING_COST_RATE_FIELD,
      action: "carrying_cost_rate_updated",
      performedBy: input.performedBy,
      performedAt: updatedAt,
      beforeJson: JSON.stringify(before),
      afterJson: JSON.stringify(after),
      detail,
    },
  });

  if (input.iamRunId) {
    await prisma.auditEvent.create({
      data: {
        iamRunId: input.iamRunId,
        entityType: "Company",
        entityId: input.companyId,
        action: "carrying_cost_rate_updated",
        performedBy: input.performedBy,
        detailJson: JSON.stringify({ before, after, source: input.source }),
      },
    });
  }

  return after;
}
