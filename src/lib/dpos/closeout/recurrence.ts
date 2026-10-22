/**
 * Stage 4E recurrence: a returning condition after a candidate is permanently closed is a NEW candidate linked to the closed one
 * (4E-D2). A closed candidate is never reopened and is never changed by the link.
 *
 * Matching uses the existing grouped-condition identity (`groupedConditionKey`, the coherent condition + action path + department +
 * objective). An exact key match links automatically (existing 4B logic). A weaker match (the same underlying condition under a
 * different key, or shared governed evidence references) is UNCERTAIN: it is recorded as REQUIRES_REVIEW and management decides; it is
 * never auto-linked, and never matched on a SKU, a title or free text alone.
 */
import type { PrismaClient } from "@prisma/client";
import { DposError, type Db } from "../errors";
import { requireText, runOperation, parseJson, toJson, type Ctx, type OperationResult, type Tx } from "../workflow/internal";
import { requireManagement, type WorkflowActor } from "../workflow/permissions";
import { normalizeFacet } from "../workflow/grouping";
import { CLOSEOUT_ORIGIN, RESOLUTION_LABELS, type ResolutionStatus } from "./vocab";

export interface RecurrenceDescriptor {
  priorCandidateId: string;
  /** Position in the chain: the original condition is 1, its first recurrence 2. */
  recurrenceSequence: number;
  /** Recurrences so far (the first recurrence is 1). */
  recurrenceCount: number;
  priorResolutionStatus: string | null;
  priorCloseoutAt: Date | null;
  priorPlanSummary: string | null;
  priorActionSummary: string | null;
}

/** The candidate this one is a recurrence of: the immutable column (exact match) or a management-confirmed link. */
export async function effectivePriorOf(db: Db, candidate: { candidateId: string; recurrenceOfCandidateId: string | null }): Promise<string | null> {
  if (candidate.recurrenceOfCandidateId) return candidate.recurrenceOfCandidateId;
  const link = await db.iamCoreRecurrenceLink.findFirst({ where: { candidateId: candidate.candidateId, matchStatus: { in: ["LINKED", "REVIEW_CONFIRMED"] } }, orderBy: { createdAt: "desc" } });
  return link?.priorCandidateId ?? null;
}

/** Oldest first, ending with `candidateId`. Guards against loops. */
export async function recurrenceChain(db: Db, candidateId: string): Promise<string[]> {
  const chain: string[] = [candidateId];
  let current = candidateId;
  for (let i = 0; i < 200; i++) {
    const c = await db.iamCoreCandidate.findUnique({ where: { candidateId: current }, select: { candidateId: true, recurrenceOfCandidateId: true } });
    if (!c) break;
    const prior = await effectivePriorOf(db, c);
    if (!prior || chain.includes(prior)) break;
    chain.unshift(prior);
    current = prior;
  }
  return chain;
}

export async function describePrior(db: Db, priorCandidateId: string, chainLengthOfPrior: number): Promise<RecurrenceDescriptor> {
  const closeout = await db.iamCoreCloseout.findUnique({ where: { candidateId: priorCandidateId } });
  const plan = await db.iamCoreManagementPlan.findFirst({ where: { candidateId: priorCandidateId, approvalState: "APPROVED" }, orderBy: { planVersion: "desc" } });
  const rec = await db.iamCoreSystemRecommendation.findFirst({ where: { candidateId: priorCandidateId }, orderBy: { recommendationVersion: "desc" } });
  const planDirection = parseJson<{ actionDirection?: string }>(plan?.planJson, {}).actionDirection ?? null;
  return {
    priorCandidateId,
    recurrenceSequence: chainLengthOfPrior + 1,
    recurrenceCount: chainLengthOfPrior,
    priorResolutionStatus: closeout?.status === "CLOSED" ? closeout.finalResolutionStatus : null,
    priorCloseoutAt: closeout?.status === "CLOSED" ? closeout.closedAt : null,
    priorPlanSummary: (plan?.planSummary ?? planDirection ?? null)?.slice(0, 1000) ?? null,
    priorActionSummary: (rec?.title ?? rec?.recommendedActionDirection ?? null)?.slice(0, 1000) ?? null,
  };
}

export async function describeRecurrenceOf(db: Db, priorCandidateId: string): Promise<RecurrenceDescriptor> {
  const chain = await recurrenceChain(db, priorCandidateId);
  return describePrior(db, priorCandidateId, chain.length);
}

/** Contract fields of a RECURRENCE_LINKED event (all optional, additive). */
export function recurrenceEventFields(d: RecurrenceDescriptor, matchStatus: "LINKED" | "REVIEW_CONFIRMED", reason: string) {
  const prior = d.priorResolutionStatus as ResolutionStatus | null;
  return {
    priorCandidateId: d.priorCandidateId,
    recurrenceReason: reason.slice(0, 4000),
    recurrenceSequence: d.recurrenceSequence,
    recurrenceCount: d.recurrenceCount,
    matchStatus,
    ...(prior ? { priorFinalResolutionStatus: prior } : {}),
    ...(d.priorCloseoutAt ? { priorCloseoutAt: d.priorCloseoutAt.toISOString() } : {}),
    ...(d.priorPlanSummary ? { priorPlanSummary: d.priorPlanSummary } : {}),
  };
}

interface FacetsJson {
  facets?: { conditionKey?: string };
}

export interface UncertainMatch {
  prior: { candidateId: string; groupedConditionKey: string; closedAt: Date | null };
  basis: "FACET_OVERLAP" | "EVIDENCE_OVERLAP";
  detail: Record<string, unknown>;
}

/**
 * Closed, formally closed-out candidates that MAY be the same condition as a new group but do not share its grouped-condition key.
 * Never matches on SKU, title or free text. At most one match per prior candidate (facet overlap wins over evidence overlap).
 */
export async function detectUncertainRecurrence(tx: Tx, ctx: Ctx, group: { groupedConditionKey: string; conditionKey: string; evidenceRefs: readonly string[] }): Promise<UncertainMatch[]> {
  const closed = await tx.iamCoreCandidate.findMany({
    where: { dposCompanyId: ctx.dposCompanyId, closedAt: { not: null }, groupedConditionKey: { not: group.groupedConditionKey }, closeout: { is: { status: "CLOSED" } } },
    orderBy: { closedAt: "desc" },
    take: 200,
  });
  const wanted = normalizeFacet(group.conditionKey);
  const out: UncertainMatch[] = [];
  for (const c of closed) {
    const facetKey = parseJson<FacetsJson>(c.groupedConditionJson, {}).facets?.conditionKey;
    if (facetKey && normalizeFacet(facetKey) === wanted) {
      out.push({ prior: { candidateId: c.candidateId, groupedConditionKey: c.groupedConditionKey, closedAt: c.closedAt }, basis: "FACET_OVERLAP", detail: { sharedConditionKey: wanted, priorGroupedConditionKey: c.groupedConditionKey, newGroupedConditionKey: group.groupedConditionKey, note: "The underlying condition matches but the action path, department or objective differs." } });
      continue;
    }
    if (group.evidenceRefs.length === 0) continue;
    const shared = await tx.iamCoreCandidateEvidence.findMany({ where: { candidateId: c.candidateId, evidenceRef: { in: [...group.evidenceRefs] } }, select: { evidenceRef: true }, take: 20 });
    if (shared.length > 0) {
      out.push({ prior: { candidateId: c.candidateId, groupedConditionKey: c.groupedConditionKey, closedAt: c.closedAt }, basis: "EVIDENCE_OVERLAP", detail: { sharedEvidenceRefs: shared.map((s) => s.evidenceRef), priorGroupedConditionKey: c.groupedConditionKey, newGroupedConditionKey: group.groupedConditionKey, note: "Governed evidence references overlap but the grouped-condition key differs." } });
    }
  }
  return out.slice(0, 3);
}

/**
 * Called inside candidate creation. An exact grouped-condition match writes the LINKED row and returns the enriched event fields; a
 * weaker match writes REQUIRES_REVIEW rows and links nothing.
 */
export async function recordRecurrenceOnCreate(
  tx: Tx,
  ctx: Ctx,
  input: { candidateId: string; groupedConditionKey: string; conditionKey: string; evidenceRefs: readonly string[]; exactPriorCandidateId: string | null; reason: string | null; at: Date },
): Promise<{ eventFields: ReturnType<typeof recurrenceEventFields> | null; reviewLinkIds: string[] }> {
  if (input.exactPriorCandidateId) {
    const d = await describeRecurrenceOf(tx, input.exactPriorCandidateId);
    const reason = input.reason ?? "The condition returned after the earlier candidate was closed.";
    await tx.iamCoreRecurrenceLink.create({
      data: {
        dposCompanyId: ctx.dposCompanyId,
        candidateId: input.candidateId,
        priorCandidateId: d.priorCandidateId,
        groupedConditionKey: input.groupedConditionKey,
        recurrenceSequence: d.recurrenceSequence,
        recurrenceCount: d.recurrenceCount,
        matchStatus: "LINKED",
        matchBasis: "EXACT_GROUPED_KEY",
        matchDetailJson: toJson({ groupedConditionKey: input.groupedConditionKey }),
        priorResolutionStatus: d.priorResolutionStatus,
        priorCloseoutAt: d.priorCloseoutAt,
        priorPlanSummary: d.priorPlanSummary,
        priorActionSummary: d.priorActionSummary,
        createdAt: input.at,
      },
    });
    return { eventFields: recurrenceEventFields(d, "LINKED", reason), reviewLinkIds: [] };
  }
  const matches = await detectUncertainRecurrence(tx, ctx, { groupedConditionKey: input.groupedConditionKey, conditionKey: input.conditionKey, evidenceRefs: input.evidenceRefs });
  const ids: string[] = [];
  for (const m of matches) {
    const d = await describeRecurrenceOf(tx, m.prior.candidateId);
    const row = await tx.iamCoreRecurrenceLink.create({
      data: {
        dposCompanyId: ctx.dposCompanyId,
        candidateId: input.candidateId,
        priorCandidateId: d.priorCandidateId,
        groupedConditionKey: input.groupedConditionKey,
        recurrenceSequence: d.recurrenceSequence,
        recurrenceCount: d.recurrenceCount,
        matchStatus: "REQUIRES_REVIEW",
        matchBasis: m.basis,
        matchDetailJson: toJson(m.detail),
        priorResolutionStatus: d.priorResolutionStatus,
        priorCloseoutAt: d.priorCloseoutAt,
        priorPlanSummary: d.priorPlanSummary,
        priorActionSummary: d.priorActionSummary,
        createdAt: input.at,
      },
    });
    ids.push(row.recurrenceId);
  }
  return { eventFields: null, reviewLinkIds: ids };
}

// ---- management review of an uncertain match -------------------------------------------------------------------------------------------

export interface ResolveRecurrenceReviewInput {
  decision: "CONFIRM" | "DECLINE";
  reason: string;
  at?: Date;
}

/**
 * Management confirms or declines an uncertain recurrence match. Both outcomes are NEW append-only rows that supersede the
 * REQUIRES_REVIEW row (the immutable candidate column is untouched). Confirming emits RECURRENCE_LINKED for the new (open) candidate;
 * the prior closed candidate is never modified.
 */
export async function resolveRecurrenceReview(
  db: PrismaClient,
  ctx: Ctx,
  actor: WorkflowActor,
  recurrenceId: string,
  input: ResolveRecurrenceReviewInput,
): Promise<OperationResult<{ recurrenceId: string; matchStatus: string; priorCandidateId: string }>> {
  requireManagement(actor, "Resolving a recurrence review");
  const row = await db.iamCoreRecurrenceLink.findUnique({ where: { recurrenceId } });
  if (!row || row.dposCompanyId !== ctx.dposCompanyId) throw new DposError("RECURRENCE_REVIEW_NOT_FOUND", "Unknown recurrence review.", 404);
  return runOperation(db, ctx, actor, row.candidateId, { operation: "RECURRENCE_REVIEW_RESOLVED", at: input.at, origin: CLOSEOUT_ORIGIN }, async (env) => {
    const { tx, em, at } = env;
    const reason = requireText(input.reason, "reason");
    if (input.decision !== "CONFIRM" && input.decision !== "DECLINE") throw new DposError("VOCABULARY_VIOLATION", "decision must be CONFIRM or DECLINE.", 400);
    const current = await tx.iamCoreRecurrenceLink.findUniqueOrThrow({ where: { recurrenceId } });
    if (current.matchStatus !== "REQUIRES_REVIEW") throw new DposError("RECURRENCE_REVIEW_NOT_PENDING", "This recurrence match is not awaiting review.", 409);
    const answered = await tx.iamCoreRecurrenceLink.findFirst({ where: { supersedesRecurrenceId: recurrenceId } });
    if (answered) throw new DposError("RECURRENCE_REVIEW_ALREADY_DECIDED", "This recurrence match has already been decided.", 409, { matchStatus: answered.matchStatus });
    const prior = await tx.iamCoreCandidate.findUniqueOrThrow({ where: { candidateId: current.priorCandidateId } });
    if (!prior.closedAt) throw new DposError("RECURRENCE_TARGET_NOT_CLOSED", "A recurrence can only follow a CLOSED candidate.", 409);
    const base = {
      dposCompanyId: ctx.dposCompanyId,
      candidateId: current.candidateId,
      priorCandidateId: current.priorCandidateId,
      groupedConditionKey: current.groupedConditionKey,
      matchBasis: current.matchBasis,
      matchDetailJson: current.matchDetailJson,
      supersedesRecurrenceId: current.recurrenceId,
      decidedBy: actor.actorId,
      decidedByRole: actor.role,
      decisionReason: reason,
      createdAt: at,
    };
    if (input.decision === "DECLINE") {
      const d = await tx.iamCoreRecurrenceLink.create({
        data: { ...base, recurrenceSequence: current.recurrenceSequence, recurrenceCount: current.recurrenceCount, matchStatus: "REVIEW_DECLINED", priorResolutionStatus: current.priorResolutionStatus, priorCloseoutAt: current.priorCloseoutAt, priorPlanSummary: current.priorPlanSummary, priorActionSummary: current.priorActionSummary },
      });
      return { recurrenceId: d.recurrenceId, matchStatus: d.matchStatus, priorCandidateId: d.priorCandidateId };
    }
    const existing = await effectivePriorOf(tx, env.candidate);
    if (existing) throw new DposError("RECURRENCE_ALREADY_LINKED", "This candidate is already linked as a recurrence of another closed candidate.", 409, { priorCandidateId: existing });
    const dsc = await describeRecurrenceOf(tx, current.priorCandidateId);
    const confirmed = await tx.iamCoreRecurrenceLink.create({
      data: { ...base, recurrenceSequence: dsc.recurrenceSequence, recurrenceCount: dsc.recurrenceCount, matchStatus: "REVIEW_CONFIRMED", priorResolutionStatus: dsc.priorResolutionStatus, priorCloseoutAt: dsc.priorCloseoutAt, priorPlanSummary: dsc.priorPlanSummary, priorActionSummary: dsc.priorActionSummary },
    });
    // The other uncertain matches for the same new candidate are answered (declined) so exactly one prior is linked.
    const others = await tx.iamCoreRecurrenceLink.findMany({ where: { candidateId: current.candidateId, matchStatus: "REQUIRES_REVIEW", recurrenceId: { not: recurrenceId } } });
    for (const o of others) {
      const done = await tx.iamCoreRecurrenceLink.findFirst({ where: { supersedesRecurrenceId: o.recurrenceId } });
      if (done) continue;
      await tx.iamCoreRecurrenceLink.create({
        data: { ...base, priorCandidateId: o.priorCandidateId, matchBasis: o.matchBasis, matchDetailJson: o.matchDetailJson, supersedesRecurrenceId: o.recurrenceId, recurrenceSequence: o.recurrenceSequence, recurrenceCount: o.recurrenceCount, matchStatus: "REVIEW_DECLINED", decisionReason: `Another prior candidate (${current.priorCandidateId}) was confirmed as the recurrence source.`, priorResolutionStatus: o.priorResolutionStatus, priorCloseoutAt: o.priorCloseoutAt, priorPlanSummary: o.priorPlanSummary, priorActionSummary: o.priorActionSummary },
      });
    }
    await tx.iamCoreWorkflowHistory.create({
      data: { candidateId: current.candidateId, dposCompanyId: ctx.dposCompanyId, fromState: env.wf.workflowState, toState: env.wf.workflowState, operation: "RECURRENCE_REVIEW_CONFIRMED", actorId: actor.actorId, actorRole: actor.role, reason, detailJson: toJson({ priorCandidateId: current.priorCandidateId, recurrenceId: confirmed.recurrenceId }), at },
    });
    await em.emit("RECURRENCE_LINKED", { recurrence: recurrenceEventFields(dsc, "REVIEW_CONFIRMED", reason) }, confirmed.recurrenceId);
    return { recurrenceId: confirmed.recurrenceId, matchStatus: confirmed.matchStatus, priorCandidateId: confirmed.priorCandidateId };
  });
}

// ---- reads --------------------------------------------------------------------------------------------------------------------------------

export interface PendingRecurrenceReview {
  recurrenceId: string;
  candidateId: string;
  candidateTitle: string | null;
  priorCandidateId: string;
  priorTitle: string | null;
  matchBasis: string;
  detail: Record<string, unknown>;
  priorResolutionStatus: string | null;
  priorResolutionLabel: string | null;
  priorCloseoutAt: string | null;
  raisedAt: string;
}

export async function pendingRecurrenceReviews(db: Db, ctx: Ctx): Promise<PendingRecurrenceReview[]> {
  const rows = await db.iamCoreRecurrenceLink.findMany({ where: { dposCompanyId: ctx.dposCompanyId, matchStatus: "REQUIRES_REVIEW" }, orderBy: { createdAt: "asc" } });
  const out: PendingRecurrenceReview[] = [];
  for (const r of rows) {
    const answered = await db.iamCoreRecurrenceLink.findFirst({ where: { supersedesRecurrenceId: r.recurrenceId } });
    if (answered) continue;
    const cand = await db.iamCoreCandidate.findUnique({ where: { candidateId: r.candidateId }, select: { closedAt: true } });
    if (cand?.closedAt) continue;
    const [wf, priorWf] = await Promise.all([db.iamCoreWorkflowState.findUnique({ where: { candidateId: r.candidateId }, select: { title: true } }), db.iamCoreWorkflowState.findUnique({ where: { candidateId: r.priorCandidateId }, select: { title: true } })]);
    out.push({
      recurrenceId: r.recurrenceId,
      candidateId: r.candidateId,
      candidateTitle: wf?.title ?? null,
      priorCandidateId: r.priorCandidateId,
      priorTitle: priorWf?.title ?? null,
      matchBasis: r.matchBasis,
      detail: parseJson<Record<string, unknown>>(r.matchDetailJson, {}),
      priorResolutionStatus: r.priorResolutionStatus,
      priorResolutionLabel: r.priorResolutionStatus ? (RESOLUTION_LABELS[r.priorResolutionStatus as ResolutionStatus] ?? r.priorResolutionStatus) : null,
      priorCloseoutAt: r.priorCloseoutAt ? r.priorCloseoutAt.toISOString() : null,
      raisedAt: r.createdAt.toISOString(),
    });
  }
  return out;
}

export interface RecurrenceContext {
  isRecurrence: boolean;
  recurrenceSequence: number;
  recurrenceCount: number;
  matchStatus: string | null;
  prior: null | {
    candidateId: string;
    title: string | null;
    closedAt: string | null;
    finalResolutionStatus: string | null;
    finalResolutionLabel: string | null;
    conditionReductionPct: number | null;
    attributionCategory: string | null;
    attributionRationale: string | null;
    residual: unknown;
    lessons: { whatWorked: string | null; whatDidNotWork: string | null; futureHandling: string | null } | null;
    planSummary: string | null;
    actionSummary: string | null;
    actionCompletionPct: number | null;
    actionCompletedAt: string | null;
    score: { domainScore: number | null; displayedRank: number | null; priorityBand: string | null } | null;
  };
  /** True only because the SCORING MODEL governs it: a prior failure never changes the new candidate's score by itself. */
  priorFailureAffectsScore: false;
  pendingReviews: number;
  statement: string;
}

/** What a new (recurrence) candidate can see about the prior closed one. Read-only. */
export async function readRecurrenceContext(db: Db, candidateId: string): Promise<RecurrenceContext> {
  const cand = await db.iamCoreCandidate.findUnique({ where: { candidateId } });
  if (!cand) throw new DposError("CANDIDATE_NOT_FOUND", "Unknown candidate.", 404);
  const priorId = await effectivePriorOf(db, cand);
  const pending = (await db.iamCoreRecurrenceLink.findMany({ where: { candidateId, matchStatus: "REQUIRES_REVIEW" } })).length;
  const base = { priorFailureAffectsScore: false as const, pendingReviews: pending, statement: "A recurrence is a new candidate: the prior closed candidate stays closed and unchanged. Its history is shown for learning only; a prior failure does not change this candidate's score." };
  if (!priorId) return { isRecurrence: false, recurrenceSequence: 1, recurrenceCount: 0, matchStatus: null, prior: null, ...base };
  const chain = await recurrenceChain(db, candidateId);
  const link = await db.iamCoreRecurrenceLink.findFirst({ where: { candidateId, priorCandidateId: priorId, matchStatus: { in: ["LINKED", "REVIEW_CONFIRMED"] } }, orderBy: { createdAt: "desc" } });
  const [wf, closeout, plan, rec, tracking, lastScore] = await Promise.all([
    db.iamCoreWorkflowState.findUnique({ where: { candidateId: priorId }, select: { title: true } }),
    db.iamCoreCloseout.findUnique({ where: { candidateId: priorId } }),
    db.iamCoreManagementPlan.findFirst({ where: { candidateId: priorId, approvalState: "APPROVED" }, orderBy: { planVersion: "desc" } }),
    db.iamCoreSystemRecommendation.findFirst({ where: { candidateId: priorId }, orderBy: { recommendationVersion: "desc" } }),
    db.iamCoreActionTracking.findUnique({ where: { candidateId: priorId } }),
    db.iamCoreScoreResult.findFirst({ where: { candidateId: priorId, outcome: "RANKED" }, orderBy: { scoredAt: "desc" } }),
  ]);
  const version = closeout && closeout.status === "CLOSED" && closeout.approvedVersion ? await db.iamCoreCloseoutVersion.findUnique({ where: { closeoutId_closeoutVersion: { closeoutId: closeout.closeoutId, closeoutVersion: closeout.approvedVersion } } }) : null;
  const learning = version ? await db.iamCoreLearningRecord.findUnique({ where: { closeoutId_closeoutVersion: { closeoutId: version.closeoutId, closeoutVersion: version.closeoutVersion } } }) : null;
  const priorCand = await db.iamCoreCandidate.findUnique({ where: { candidateId: priorId }, select: { closedAt: true } });
  const final = closeout?.status === "CLOSED" ? closeout.finalResolutionStatus : null;
  return {
    isRecurrence: true,
    recurrenceSequence: chain.length,
    recurrenceCount: chain.length - 1,
    matchStatus: link?.matchStatus ?? (cand.recurrenceOfCandidateId ? "LINKED" : null),
    prior: {
      candidateId: priorId,
      title: wf?.title ?? null,
      closedAt: priorCand?.closedAt ? priorCand.closedAt.toISOString() : null,
      finalResolutionStatus: final,
      finalResolutionLabel: final ? (RESOLUTION_LABELS[final as ResolutionStatus] ?? final) : null,
      conditionReductionPct: version?.conditionReductionPct ?? null,
      attributionCategory: closeout?.finalAttributionCategory ?? null,
      attributionRationale: version?.attributionRationale ?? null,
      residual: parseJson<unknown>(version?.residualJson, null),
      lessons: learning ? { whatWorked: learning.whatWorked, whatDidNotWork: learning.whatDidNotWork, futureHandling: learning.futureHandling } : null,
      planSummary: plan?.planSummary ?? null,
      actionSummary: rec?.title ?? rec?.recommendedActionDirection ?? null,
      actionCompletionPct: tracking?.actionCompletionPct ?? null,
      actionCompletedAt: tracking?.completedAt ? tracking.completedAt.toISOString() : null,
      score: lastScore ? { domainScore: lastScore.domainScore, displayedRank: lastScore.displayedRank, priorityBand: lastScore.priorityBand } : null,
    },
    ...base,
  };
}
