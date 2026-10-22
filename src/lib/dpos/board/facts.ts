/**
 * Stage 4D board facts: one batched load of what every board section needs about the company's open candidates. Read-only.
 */
import type { Prisma } from "@prisma/client";
import type { Db } from "../errors";
import { latestDisplayStates, publishedStateOfResult } from "../scoring/display-refresh";
import type { PublishedState } from "../scoring/publish";
import { parseJson } from "../workflow/internal";
import type { ScoringInputs } from "../scoring/inputs";

const candidateInclude = {
  workflowState: true,
  actionTracking: true,
  ownerships: { where: { endedAt: null }, include: { contributors: true } },
  recommendations: { orderBy: { recommendationVersion: "desc" as const }, take: 1 },
  managementPlans: { orderBy: { planVersion: "desc" as const } },
  decisionRequired: { where: { status: "OPEN" } },
  managementDecisions: { where: { decisionType: "APPROVE" }, orderBy: { decidedAt: "asc" as const }, take: 1 },
} satisfies Prisma.IamCoreCandidateInclude;

export type CandidateRow = Prisma.IamCoreCandidateGetPayload<{ include: typeof candidateInclude }>;

export interface DisplayState {
  /** The state management sees: the latest immediately-published display change when newer than the latest run, else the run result. */
  state: PublishedState;
  scoredAt: Date;
  scoringRunId: string;
  scoreResultId: string;
  dataConfidence: string | null;
  emergencyReviewCandidate: boolean;
  /** True when an immediate governance display change (rank lock / override / tie-break) is in force over the run's values. */
  fromDisplayChange: boolean;
}

export interface CandidateFacts {
  row: CandidateRow;
  inputs: ScoringInputs | null;
  inputVersion: number | null;
  display: DisplayState | null;
  approvedAt: Date | null;
}

export async function loadCandidateFacts(db: Db, companyId: string, opts: { includeClosed?: boolean } = {}): Promise<CandidateFacts[]> {
  const rows = await db.iamCoreCandidate.findMany({
    where: { dposCompanyId: companyId, ...(opts.includeClosed ? {} : { closedAt: null }) },
    include: candidateInclude,
    orderBy: [{ originalCreatedAt: "asc" }, { candidateId: "asc" }],
  });
  const ids = rows.map((r) => r.candidateId);
  if (!ids.length) return [];
  const inputRows = await db.iamCoreScoringInput.findMany({ where: { candidateId: { in: ids } }, orderBy: { inputVersion: "desc" }, distinct: ["candidateId"] });
  const inputBy = new Map(inputRows.map((r) => [r.candidateId, r]));
  const resultRows = await db.iamCoreScoreResult.findMany({ where: { candidateId: { in: ids }, outcome: "RANKED" }, orderBy: { scoredAt: "desc" }, distinct: ["candidateId"] });
  const resultBy = new Map(resultRows.map((r) => [r.candidateId, r]));
  const displays = await latestDisplayStates(db, ids);
  return rows.map((row) => {
    const input = inputBy.get(row.candidateId);
    const result = resultBy.get(row.candidateId);
    const disp = displays.get(row.candidateId);
    let display: DisplayState | null = null;
    if (result) {
      const useDisplay = !!disp && disp.createdAt.getTime() > result.scoredAt.getTime() && !!disp.state;
      display = {
        state: useDisplay ? disp!.state : publishedStateOfResult(result),
        scoredAt: result.scoredAt,
        scoringRunId: result.scoringRunId,
        scoreResultId: result.scoreResultId,
        dataConfidence: result.dataConfidence,
        emergencyReviewCandidate: useDisplay ? disp!.state.emergencyReviewCandidate : result.emergencyReviewCandidate,
        fromDisplayChange: useDisplay,
      };
    }
    return {
      row,
      inputs: input ? parseJson<ScoringInputs | null>(input.inputsJson, null) : null,
      inputVersion: input?.inputVersion ?? null,
      display,
      approvedAt: row.managementDecisions[0]?.decidedAt ?? null,
    };
  });
}

export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A short, factual exposure summary from the stored scoring inputs (nothing is estimated). */
export function exposureOf(f: CandidateFacts): { inventory: number | null; cashImpact: number | null; profitImpact: number | null; baseline: number | null; unit: string | null } {
  return {
    inventory: num(f.inputs?.inventoryExposure?.affectedInventoryBookValue),
    cashImpact: num(f.inputs?.cash?.expected13WeekNetCashImpact),
    profitImpact: num(f.inputs?.profitability?.netProfitabilityImpact),
    baseline: num(f.row.actionTracking?.baselineExposure),
    unit: f.row.actionTracking?.exposureUnit ?? null,
  };
}

export const titleOf = (f: CandidateFacts): string => f.row.workflowState?.title ?? f.row.recommendations[0]?.title ?? f.row.groupedConditionKey;
