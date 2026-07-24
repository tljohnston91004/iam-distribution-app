/**
 * Active Defer detection for Board presentation (V1.5 product clarification).
 * Defer / ReactivateFromDefer are governance outcomes — not lifecycle states.
 */

import { prisma } from "@/lib/db";

const DEFER_OUTCOME_TYPES = ["Defer", "ReactivateFromDefer"] as const;

/**
 * True when the latest Defer-related governance decision is still Defer
 * (not superseded by ReactivateFromDefer).
 */
export async function isDeferActive(recommendationId: string): Promise<boolean> {
  const latest = await prisma.governanceDecision.findFirst({
    where: {
      recommendationId,
      decisionType: { in: [...DEFER_OUTCOME_TYPES] },
    },
    orderBy: { performedAt: "desc" },
  });
  return latest?.decisionType === "Defer";
}

/** Batch helper for presentation assignment. */
export async function loadActiveDeferIds(recommendationIds: string[]): Promise<Set<string>> {
  if (recommendationIds.length === 0) return new Set();
  const decisions = await prisma.governanceDecision.findMany({
    where: {
      recommendationId: { in: recommendationIds },
      decisionType: { in: [...DEFER_OUTCOME_TYPES] },
    },
    orderBy: { performedAt: "desc" },
  });
  const latestByRec = new Map<string, string>();
  for (const d of decisions) {
    if (!latestByRec.has(d.recommendationId)) {
      latestByRec.set(d.recommendationId, d.decisionType);
    }
  }
  const active = new Set<string>();
  for (const [id, type] of latestByRec) {
    if (type === "Defer") active.add(id);
  }
  return active;
}
