/**
 * Phase 4 / EEP presentation service — Board lanes independent of lifecycle mutation.
 * Never writes lifecycleState. No adapter imports (ADR-IAM-001).
 *
 * EEP (PO 2026-07-21): OEC-aware Active Priorities + Waiting; Paused does not consume OEC;
 * Deferred Presentation Rule preserved (no activation competition).
 */

import { prisma } from "@/lib/db";
import type { PresentationCategory } from "@/lib/iam/inbound/types";
import { loadActiveDeferIds } from "./defer-status";
import { countHoldoverConsumers, getOecForRun } from "./oec";
import { buildTrustStory } from "./story";
import {
  EMERGENCY_ASSIGNMENT_ENABLED,
  HOLDOVER_LIFECYCLE_STATES,
  PRESERVED_PRESENTATION,
} from "./rules";

export type PresentationAssignment = {
  recommendationId: string;
  presentationCategory: PresentationCategory;
  presentationRank: number | null;
  reason: string;
};

export type PresentationLaneSummary = {
  active_priority: string[];
  waiting_activation: string[];
  /** @deprecated alias mirrored from active_priority for legacy callers */
  top_2: string[];
  emergency: string[];
  holdover: string[];
  deferred: string[];
  /** @deprecated alias mirrored from waiting_activation */
  managed_backlog: string[];
  completed_presentation: string[];
  archived_history: string[];
};

function emptyLanes(): PresentationLaneSummary {
  return {
    active_priority: [],
    waiting_activation: [],
    top_2: [],
    emergency: [],
    holdover: [],
    deferred: [],
    managed_backlog: [],
    completed_presentation: [],
    archived_history: [],
  };
}

/**
 * Assign presentation categories from scored Recommendations.
 * - Preserves completed_presentation / archived_history
 * - Active Defer → deferred (visible; not Active Priority)
 * - Open execution LS → holdover lane (Paused visible; does not consume OEC)
 * - Remaining ranked by priorityScore → Active Priorities up to available OEC, else Waiting
 * - Emergency stubbed until SD-2
 * Does not recalculate Priority Score.
 */
export async function assignPresentation(iamRunId: string): Promise<{
  assignments: PresentationAssignment[];
  lanes: PresentationLaneSummary;
  oec: { capacity: number; holdoverConsumed: number; promoted: number };
}> {
  const recs = await prisma.recommendation.findMany({ where: { iamRunId } });
  const activeDeferIds = await loadActiveDeferIds(recs.map((r) => r.id));
  const oecCfg = await getOecForRun(iamRunId);
  const holdoverConsumed = countHoldoverConsumers(recs, activeDeferIds);
  const promoteSlots = Math.max(0, oecCfg.organizationalExecutionCapability - holdoverConsumed);

  const assignments: PresentationAssignment[] = [];
  const competing: typeof recs = [];

  for (const rec of recs) {
    const current = rec.presentationCategory as PresentationCategory;
    if (PRESERVED_PRESENTATION.has(current)) {
      assignments.push({
        recommendationId: rec.id,
        presentationCategory: current,
        presentationRank: rec.presentationRank,
        reason: "preserved_terminal_presentation",
      });
      continue;
    }

    if (activeDeferIds.has(rec.id)) {
      assignments.push({
        recommendationId: rec.id,
        presentationCategory: "deferred",
        presentationRank: null,
        reason: "active_defer_presentation_rule",
      });
      continue;
    }

    if (HOLDOVER_LIFECYCLE_STATES.has(rec.lifecycleState)) {
      assignments.push({
        recommendationId: rec.id,
        presentationCategory: "holdover",
        presentationRank: null,
        reason:
          rec.lifecycleState === "Paused"
            ? "open_execution_holdover_paused_no_oec"
            : "open_execution_holdover_lane",
      });
      continue;
    }

    competing.push(rec);
  }

  competing.sort((a, b) => {
    // Financial exposure leads; priorityScore already encodes operational override when justified.
    const ca = a.estimatedCashImpact ?? a.estimatedFinancialImpact ?? 0;
    const cb = b.estimatedCashImpact ?? b.estimatedFinancialImpact ?? 0;
    if (Math.abs(cb - ca) > 0.01) return cb - ca;
    const sa = a.priorityScore ?? 0;
    const sb = b.priorityScore ?? 0;
    if (sb !== sa) return sb - sa;
    return a.id.localeCompare(b.id);
  });

  void EMERGENCY_ASSIGNMENT_ENABLED;

  competing.forEach((rec, i) => {
    if (i < promoteSlots) {
      assignments.push({
        recommendationId: rec.id,
        presentationCategory: "active_priority",
        presentationRank: i + 1,
        reason: `oec_promoted_slot_${i + 1}_of_${promoteSlots}`,
      });
    } else {
      assignments.push({
        recommendationId: rec.id,
        presentationCategory: "waiting_activation",
        presentationRank: i + 1,
        reason: "ranked_waiting_activation",
      });
    }
  });

  for (const a of assignments) {
    const rec = recs.find((r) => r.id === a.recommendationId)!;
    const story = buildTrustStory(rec);
    await prisma.recommendation.update({
      where: { id: a.recommendationId },
      data: {
        presentationCategory: a.presentationCategory,
        presentationRank: a.presentationRank,
        storyWhat: story.storyWhat,
        storyWhy: story.storyWhy,
        storyWhyNow: story.storyWhyNow,
        storyExpectedResult: story.storyExpectedResult,
        confidenceNarrative: story.confidenceNarrative,
      },
    });
  }

  const lanes = emptyLanes();
  for (const a of assignments) {
    const cat = a.presentationCategory;
    if (cat === "active_priority") {
      lanes.active_priority.push(a.recommendationId);
      lanes.top_2.push(a.recommendationId);
    } else if (cat === "waiting_activation") {
      lanes.waiting_activation.push(a.recommendationId);
      lanes.managed_backlog.push(a.recommendationId);
    } else if (cat in lanes) {
      lanes[cat as keyof PresentationLaneSummary].push(a.recommendationId);
    }
  }

  return {
    assignments,
    lanes,
    oec: {
      capacity: oecCfg.organizationalExecutionCapability,
      holdoverConsumed,
      promoted: lanes.active_priority.length,
    },
  };
}

/** Read current Board lanes for a Review Cycle (no mutation). */
export async function getPresentationLanes(iamRunId: string): Promise<PresentationLaneSummary> {
  const recs = await prisma.recommendation.findMany({
    where: { iamRunId },
    orderBy: [{ presentationRank: "asc" }, { priorityScore: "desc" }],
  });
  const lanes = emptyLanes();
  for (const r of recs) {
    const cat = r.presentationCategory as PresentationCategory;
    if (cat === "active_priority" || cat === "top_2") {
      lanes.active_priority.push(r.id);
      lanes.top_2.push(r.id);
    } else if (cat === "waiting_activation" || cat === "managed_backlog") {
      lanes.waiting_activation.push(r.id);
      lanes.managed_backlog.push(r.id);
    } else if (cat in lanes) {
      lanes[cat as keyof PresentationLaneSummary].push(r.id);
    }
  }
  return lanes;
}
