/**
 * Plain-English Decision Board copy helpers — RSE/DPOS Doors company-home voice.
 */
import { usd } from "@/lib/format";
import type { BoardRecommendation } from "./types";
import { isActivePriorityCategory } from "@/lib/iam/presentation/rules";

export type PriorityBand = "High" | "Medium" | "Low" | "Unscored";

export function priorityBand(score: number | null): PriorityBand {
  if (score == null) return "Unscored";
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

export function boardRyg(input: {
  readinessStatus: string;
  recommendationCount: number;
  dataGapCount: number;
  decisionsNeeded: number;
}): { label: "Gray" | "Yellow" | "Green" | "Red"; note: string } {
  const readiness = input.readinessStatus.toLowerCase();
  if (input.recommendationCount === 0 || readiness.includes("not ready") || readiness === "draft") {
    return {
      label: "Gray",
      note: "insufficient cycle evidence. This is not a company-health score — open Operations intake, approve evidence, then Calculate · Score · Present.",
    };
  }
  if (input.decisionsNeeded > 0) {
    return {
      label: "Yellow",
      note: `${input.decisionsNeeded} management decision(s) still open this week. Board RYG is cycle status, not RSE module health.`,
    };
  }
  if (input.dataGapCount > 0 || readiness.includes("limitation")) {
    return {
      label: "Yellow",
      note:
        input.dataGapCount > 0
          ? `${input.dataGapCount} data gap(s) may reduce confidence. Board RYG is not a company-health score.`
          : `Readiness is “${input.readinessStatus}”. Board RYG is cycle status, not a company-health score.`,
    };
  }
  return {
    label: "Green",
    note: "Active Priorities are presented and capacity is clear enough to run the weekly meeting. Board RYG is not a company-health score.",
  };
}

export function guidingQuestion(recs: BoardRecommendation[]): string {
  const active = recs
    .filter((r) => isActivePriorityCategory(r.presentationCategory) || r.lifecycleState === "Management Review")
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
  const top = active[0];
  if (!top) {
    return "What should management take on this week — and is last week’s work still unfinished?";
  }
  const cash = top.estimatedCashImpact ?? top.estimatedFinancialImpact;
  if (cash != null) {
    return `Is the ${usd(cash)} ${shortType(top)} still on track?`;
  }
  return `Is “${top.title}” still the right thing to take on this week?`;
}

function shortType(rec: BoardRecommendation): string {
  const t = rec.recommendationType.replace(/_/g, " ").toLowerCase();
  return t.length > 48 ? `${t.slice(0, 45)}…` : t;
}

export function actSkipCopy(rec: BoardRecommendation): { means: string; act: string; skip: string } {
  const cash = rec.estimatedCashImpact ?? rec.estimatedFinancialImpact;
  const cashBit = cash != null ? ` (about ${usd(cash)})` : "";
  const means =
    rec.storyWhy ||
    rec.storyWhat ||
    `${rec.title}${cashBit}. Evidence from ${rec.sourceModule} flags this for management attention.`;
  const act =
    rec.storyExpectedResult ||
    rec.storyWhat ||
    `Act. Take this on so the ${rec.recommendationType.replace(/_/g, " ").toLowerCase()} exposure can be worked this week.`;
  const skip = `Skip. The exposure stays open${cashBit}. The same issue returns next week as a holdover.`;
  return { means, act, skip };
}

export function lookThisWeekRole(rec: BoardRecommendation): string {
  if (rec.ownerName) return `${rec.ownerName} · look this week`;
  const t = rec.recommendationType.toLowerCase();
  if (t.includes("replenish") || t.includes("stock") || t.includes("shortfall")) {
    return "Owner · look this week";
  }
  if (t.includes("excess") || t.includes("working capital") || t.includes("cash")) {
    return "Purchasing · look this week";
  }
  return "Management · look this week";
}

export function moneyTiles(recs: BoardRecommendation[], dataGapCount: number) {
  const cashOf = (r: BoardRecommendation) => r.estimatedCashImpact ?? r.estimatedFinancialImpact ?? 0;
  const active = recs.filter((r) => isActivePriorityCategory(r.presentationCategory));
  const holdover = recs.filter((r) => r.presentationCategory === "holdover");
  const waiting = recs.filter(
    (r) => r.presentationCategory === "waiting_activation" || r.presentationCategory === "managed_backlog"
  );
  const activeCash = active.reduce((s, r) => s + cashOf(r), 0);
  const holdoverCash = holdover.reduce((s, r) => s + cashOf(r), 0);
  const waitingCash = waiting.reduce((s, r) => s + cashOf(r), 0);
  const totalOpen = activeCash + holdoverCash + waitingCash;

  return [
    {
      amount: activeCash > 0 ? usd(activeCash) : "—",
      label: "Active Priorities · cash",
    },
    {
      amount: holdoverCash > 0 ? usd(holdoverCash) : String(holdover.length),
      label: holdoverCash > 0 ? "Holdover / WIP · cash" : "Holdover / WIP items",
    },
    {
      amount: waitingCash > 0 ? usd(waitingCash) : String(waiting.length),
      label: waitingCash > 0 ? "Waiting · cash" : "Waiting for Activation",
    },
    {
      amount: totalOpen > 0 ? usd(totalOpen) : String(recs.length),
      label: totalOpen > 0 ? "Open board exposure" : "Recommendations on board",
    },
    {
      amount: String(dataGapCount),
      label: "Data gaps",
    },
  ] as const;
}
