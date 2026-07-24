/**
 * Weekly Business Summary + Business Momentum — derived from measurable run facts only.
 */
import type { BoardRecommendation } from "@/lib/iam/board/types";
import { isActivePriorityCategory, isWaitingCategory } from "./rules";
import { usd } from "@/lib/format";

export type WeeklyBusinessSummary = {
  headline: string;
  bullets: string[];
  attentionZone: "immediate" | "monitor" | "informational";
};

export type BusinessMomentum = {
  direction: "improving" | "stable" | "pressured" | "unclear";
  reason: string;
};

export function buildWeeklyBusinessSummary(input: {
  recommendationCount: number;
  dataGapCount: number;
  readinessStatus: string;
  recommendations: BoardRecommendation[];
  oec: number;
  oecConsumed: number;
}): WeeklyBusinessSummary {
  const active = input.recommendations.filter((r) => isActivePriorityCategory(r.presentationCategory));
  const waiting = input.recommendations.filter((r) => isWaitingCategory(r.presentationCategory));
  const deferred = input.recommendations.filter((r) => r.presentationCategory === "deferred");
  const holdover = input.recommendations.filter((r) => r.presentationCategory === "holdover");
  const cashSum = active.reduce(
    (s, r) => s + (r.estimatedCashImpact ?? r.estimatedFinancialImpact ?? 0),
    0
  );

  const bullets = [
    `${active.length} Active Priorit${active.length === 1 ? "y" : "ies"} within OEC ${input.oec} (${input.oecConsumed} slot(s) consumed including Holdover).`,
    `${waiting.length} Waiting for Activation · ${deferred.length} Deferred · ${holdover.length} in Holdover / WIP.`,
    cashSum > 0
      ? `Active Priorities carry roughly ${usd(cashSum)} combined estimated cash impact.`
      : `Cash impact on Active Priorities is not yet fully quantified.`,
    input.dataGapCount > 0
      ? `${input.dataGapCount} data gap(s) may limit confidence — review Operations intake if needed.`
      : `No open data gaps recorded for this cycle.`,
  ];

  const needsDecision = input.recommendations.filter(
    (r) =>
      r.lifecycleState === "Management Review" &&
      (isActivePriorityCategory(r.presentationCategory) || isWaitingCategory(r.presentationCategory))
  ).length;

  let attentionZone: WeeklyBusinessSummary["attentionZone"] = "informational";
  if (needsDecision > 0 || input.readinessStatus !== "Ready") attentionZone = "immediate";
  else if (holdover.length > 0 || waiting.length > input.oec) attentionZone = "monitor";

  const headline =
    needsDecision > 0
      ? `${needsDecision} decision(s) need management attention this week.`
      : holdover.length > 0
        ? `Execution in progress — ${holdover.length} Holdover item(s) consuming capacity.`
        : `Capacity is clear for up to ${Math.max(0, input.oec - input.oecConsumed)} new Active Priorit${input.oec - input.oecConsumed === 1 ? "y" : "ies"}.`;

  return { headline, bullets, attentionZone };
}

export function buildBusinessMomentum(input: {
  recommendations: BoardRecommendation[];
  completedCount: number;
  deferredCount: number;
  dataGapCount: number;
}): BusinessMomentum {
  const activeWork = input.recommendations.filter(
    (r) =>
      r.lifecycleState === "Active" ||
      r.lifecycleState === "Escalated" ||
      r.presentationCategory === "holdover"
  ).length;
  const blocked = input.recommendations.filter((r) => Boolean(r.blockerNote)).length;

  if (input.completedCount > 0 && blocked === 0 && input.dataGapCount === 0) {
    return {
      direction: "improving",
      reason: `${input.completedCount} recently completed item(s) and no recorded blockers on open work.`,
    };
  }
  if (blocked > 0 || input.deferredCount > activeWork) {
    return {
      direction: "pressured",
      reason:
        blocked > 0
          ? `${blocked} open item(s) report blockers; capacity may be constrained.`
          : `Deferred volume (${input.deferredCount}) exceeds active Holdover — attention may be delayed.`,
    };
  }
  if (activeWork > 0) {
    return {
      direction: "stable",
      reason: `${activeWork} item(s) in execution or Holdover with no dominant blocker signal.`,
    };
  }
  return {
    direction: "unclear",
    reason: "Limited execution signal this cycle — promote Active Priorities or complete intake.",
  };
}
