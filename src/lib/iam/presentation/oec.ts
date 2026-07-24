/**
 * Organizational Execution Capability (EEP / Blueprint §5).
 * Consumption: Active Priorities + Holdover (non-Paused). Deferred / Waiting / Paused do not consume.
 */
import { prisma } from "@/lib/db";
import { loadActiveDeferIds } from "./defer-status";
import {
  DEFAULT_OEC,
  HOLDOVER_LIFECYCLE_STATES,
  OEC_CONSUMING_LIFECYCLE_STATES,
  isActivePriorityCategory,
} from "./rules";

export type OecConfig = {
  companyId: string;
  organizationalExecutionCapability: number;
  recommendationAgingDays: number;
};

export async function getCompanyOec(companyId: string): Promise<OecConfig> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  return {
    companyId: company.id,
    organizationalExecutionCapability: company.organizationalExecutionCapability ?? DEFAULT_OEC,
    recommendationAgingDays: company.recommendationAgingDays ?? 14,
  };
}

export async function getOecForRun(iamRunId: string): Promise<OecConfig> {
  const run = await prisma.iamRun.findUniqueOrThrow({
    where: { id: iamRunId },
    select: { companyId: true },
  });
  return getCompanyOec(run.companyId);
}

export async function setCompanyOec(input: {
  companyId: string;
  organizationalExecutionCapability: number;
  recommendationAgingDays?: number;
  performedBy: string;
  /** When provided, writes an AuditEvent on that Review Cycle. */
  iamRunId?: string;
}): Promise<OecConfig> {
  const oec = Math.max(1, Math.floor(input.organizationalExecutionCapability));
  const aging =
    input.recommendationAgingDays != null
      ? Math.max(1, Math.floor(input.recommendationAgingDays))
      : undefined;

  const before = await getCompanyOec(input.companyId);
  const company = await prisma.company.update({
    where: { id: input.companyId },
    data: {
      organizationalExecutionCapability: oec,
      ...(aging != null ? { recommendationAgingDays: aging } : {}),
    },
  });

  if (input.iamRunId) {
    await prisma.auditEvent.create({
      data: {
        iamRunId: input.iamRunId,
        entityType: "Company",
        entityId: input.companyId,
        action: "oec_config_updated",
        performedBy: input.performedBy,
        detailJson: JSON.stringify({
          before: {
            organizationalExecutionCapability: before.organizationalExecutionCapability,
            recommendationAgingDays: before.recommendationAgingDays,
          },
          after: {
            organizationalExecutionCapability: company.organizationalExecutionCapability,
            recommendationAgingDays: company.recommendationAgingDays,
          },
        }),
      },
    });
  }

  return {
    companyId: company.id,
    organizationalExecutionCapability: company.organizationalExecutionCapability,
    recommendationAgingDays: company.recommendationAgingDays,
  };
}

export type OecConsumption = {
  oec: number;
  consumed: number;
  available: number;
  consumers: { recommendationId: string; reason: string }[];
};

/**
 * Count OEC consumers for a Review Cycle (read-only).
 * Active Priorities + Holdover with consuming lifecycle; Paused / Deferred / Waiting excluded.
 */
export async function measureOecConsumption(iamRunId: string): Promise<OecConsumption> {
  const cfg = await getOecForRun(iamRunId);
  const recs = await prisma.recommendation.findMany({ where: { iamRunId } });
  const activeDeferIds = await loadActiveDeferIds(recs.map((r) => r.id));
  const consumers: { recommendationId: string; reason: string }[] = [];

  for (const rec of recs) {
    if (activeDeferIds.has(rec.id)) continue;
    if (rec.lifecycleState === "Paused") continue;
    if (rec.lifecycleState === "Archived") continue;
    if (rec.presentationCategory === "completed_presentation" || rec.presentationCategory === "archived_history") {
      continue;
    }

    if (isActivePriorityCategory(rec.presentationCategory)) {
      consumers.push({ recommendationId: rec.id, reason: "active_priority" });
      continue;
    }

    if (
      HOLDOVER_LIFECYCLE_STATES.has(rec.lifecycleState) &&
      OEC_CONSUMING_LIFECYCLE_STATES.has(rec.lifecycleState)
    ) {
      consumers.push({ recommendationId: rec.id, reason: `holdover_${rec.lifecycleState}` });
    }
  }

  const consumed = consumers.length;
  return {
    oec: cfg.organizationalExecutionCapability,
    consumed,
    available: Math.max(0, cfg.organizationalExecutionCapability - consumed),
    consumers,
  };
}

/**
 * Holdover-only consumption used during promotion (before Active Priorities are assigned).
 * Paused does not consume.
 */
export function countHoldoverConsumers(
  recs: { id: string; lifecycleState: string }[],
  activeDeferIds: Set<string>
): number {
  let n = 0;
  for (const rec of recs) {
    if (activeDeferIds.has(rec.id)) continue;
    if (rec.lifecycleState === "Paused") continue;
    if (
      HOLDOVER_LIFECYCLE_STATES.has(rec.lifecycleState) &&
      OEC_CONSUMING_LIFECYCLE_STATES.has(rec.lifecycleState)
    ) {
      n += 1;
    }
  }
  return n;
}
