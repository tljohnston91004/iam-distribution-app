/**
 * Stage 4C: governed scoring runs.
 *
 * `recordScoringInputs` stores the validated, versioned facts the engine scores. `runScoring` is the governed run: in ONE
 * transaction it scores every eligible canonical candidate of the company with ONE scoring version and configuration, orders
 * them deterministically, assigns domainRank (calculated) and the displayed (management) rank, selects the Top 2, raises
 * emergency-review candidates and forced reviews, persists every result with its full explanation, and writes the Results
 * Return events (CANDIDATE_SCORED / DOMAIN_PRIORITY_CHANGED) to the outbox. Scoring applies to canonical integrated candidates
 * only: legacy V1.5 records are never scored.
 *
 * Nothing here changes the original system recommendation, a Stage 4B workflow state, or any RSE/PRE business logic.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "../audit";
import { DposError, type Db } from "../errors";
import { Emitter, SCORING_ORIGIN, countQualifiedRejections, parseJson, toJson, type EmittedEvent } from "../workflow/internal";
import { assertActor, requireSystemOrManagement, SYSTEM_ACTOR, type WorkflowActor } from "../workflow/permissions";
import { signalConditionChange } from "../workflow/management";
import { calculateScore, type ScoreCalculation } from "./calculate";
import { SCORING_CONFIG, SCORING_VERSION, SCORING_CONFIG_VERSION, canonicalJson, configHash, sha256Json, type ScoringConfig } from "./config";
import { iamOperatingPeriodFor, isValidIanaTimeZone } from "../contract/iam-results-return";
import { economicKey, validateScoringInputs, type ScoringInputs } from "./inputs";
import { POOL_STATES, TOP2_STATES, activeLocks, activeOverrides, activeStrategic, assertStableUserId, manualTieBreakGroups, type Tx } from "./ledger";
import { chooseEvent, chooseUnscoredEvent, flagsOnlySections, scoreSections, scoringStateOfExclusion, scoringStateSections, type PublishedState, type ScoringState } from "./publish";
import { latestDisplayStates, publishedStateOfResult } from "./display-refresh";
import { applyRankLocks, orderItems, scoreAtLeast, selectTop2, type RankItem, type TieNote } from "./ranking";

type Ctx = { dposCompanyId: string; companyTimeZone?: string | null };
const DAY_MS = 24 * 3600 * 1000;

// ---- recording scoring inputs ------------------------------------------------------------------------------------------------

export interface RecordInputsResult {
  candidateId: string;
  inputId: string;
  inputVersion: number;
  inputsHash: string;
  /** True when the facts were identical to the latest version, so no new version was written. */
  unchanged: boolean;
}

/** Store (a new version of) the facts the engine scores for a candidate. Invalid facts are refused with every issue listed. */
export async function recordScoringInputs(
  db: PrismaClient,
  ctx: Ctx,
  actor: WorkflowActor,
  candidateId: string,
  rawInputs: unknown,
  opts: { at?: Date; sourceRefs?: string[] } = {},
): Promise<RecordInputsResult> {
  requireSystemOrManagement(actor, "Recording scoring inputs");
  assertStableUserId(actor, "Recording scoring inputs");
  const v = validateScoringInputs(rawInputs);
  if (!v.ok || !v.value) throw new DposError("SCORING_INPUTS_INVALID", "The scoring inputs are not valid.", 400, { issues: v.issues });
  const value = v.value;
  const hash = sha256Json(value);
  return db.$transaction(async (tx) => {
    const cand = await tx.iamCoreCandidate.findUnique({ where: { candidateId } });
    if (!cand || cand.dposCompanyId !== ctx.dposCompanyId) throw new DposError("CANDIDATE_NOT_FOUND", "Unknown candidate.", 404);
    if (cand.closedAt) throw new DposError("CLOSED_CANDIDATE_NO_REOPEN", "This candidate is closed; closed candidates are never rescored.", 409);
    const latest = await tx.iamCoreScoringInput.findFirst({ where: { candidateId }, orderBy: { inputVersion: "desc" } });
    if (latest && latest.inputsHash === hash) return { candidateId, inputId: latest.inputId, inputVersion: latest.inputVersion, inputsHash: hash, unchanged: true };
    const at = opts.at ?? new Date();
    const row = await tx.iamCoreScoringInput.create({
      data: {
        candidateId,
        dposCompanyId: ctx.dposCompanyId,
        inputVersion: (latest?.inputVersion ?? 0) + 1,
        inputsJson: canonicalJson(value),
        inputsHash: hash,
        sourceRefsJson: toJson(opts.sourceRefs ?? value.sourceRefs ?? null),
        recordedBy: actor.actorId,
        recordedAt: at,
      },
    });
    await writeAudit(tx, { category: "SCORING", action: "SCORING_INPUTS_RECORDED", outcome: "SUCCESS", actor: actor.actorId, dposCompanyId: ctx.dposCompanyId, subjectType: "IamCoreCandidate", subjectId: candidateId, detail: { inputVersion: row.inputVersion, inputsHash: hash }, at });
    return { candidateId, inputId: row.inputId, inputVersion: row.inputVersion, inputsHash: hash, unchanged: false };
  });
}

// ---- persistence history -----------------------------------------------------------------------------------------------------

export interface PriorOccurrence {
  scoredAt: Date;
  /** The company-local operating week (the Sunday, YYYY-MM-DD) the result belongs to; derived from scoredAt when an older row has none. */
  operatingWeekStart?: string | null;
  /** The candidate was ranked in that run with a score at or above the qualifying minimum. */
  qualified: boolean;
}

/**
 * 4C-D1: the company operating week a scoring run belongs to: Sunday-Saturday in the COMPANY'S IANA time zone, identified by the Sunday
 * (YYYY-MM-DD). The company's local calendar decides - never UTC - so two companies in different zones can be in different weeks at the
 * same UTC instant, a local Saturday-night run is still that week even when UTC has rolled over, and daylight-saving changes never move a
 * week boundary (the week is derived from the local calendar date, not from a fixed 168-hour offset).
 */
export function operatingWeekOf(at: Date, timeZone: string): string {
  return iamOperatingPeriodFor(at, timeZone).start;
}

/**
 * Consecutive qualified occurrence number for the CURRENT run (1 = first).
 *  - ONE qualified occurrence per company operating week: any number of runs in the same week count once, and a run in the current week
 *    never adds a second occurrence.
 *  - A week is represented by its latest scoring result. A week whose result was excluded, not rankable or below the qualifying minimum
 *    BREAKS the streak.
 *  - SKIPPED-WEEK RULE (documented decision): a week in which NO scoring cycle ran for the company is neutral - it neither counts as an
 *    occurrence nor breaks the streak (a missed cycle is an operational gap, not evidence that the condition went away).
 */
export function occurrenceNumber(prior: PriorOccurrence[], currentWeekStart: string, timeZone: string): number {
  const byWeek = new Map<string, boolean>();
  for (const p of [...prior].sort((a, b) => b.scoredAt.getTime() - a.scoredAt.getTime())) {
    const w = p.operatingWeekStart ?? operatingWeekOf(p.scoredAt, timeZone);
    if (w >= currentWeekStart) continue; // the same (or a later) week is the current occurrence, not a prior one
    if (!byWeek.has(w)) byWeek.set(w, p.qualified); // the latest run of each earlier week represents that week
  }
  let streak = 0;
  for (const w of [...byWeek.keys()].sort().reverse()) {
    if (!byWeek.get(w)) break;
    streak++;
  }
  return streak + 1;
}

/** The company IANA time zone for a run: the explicit context value, else the bound company configuration. Fails closed. */
async function companyTimeZoneFor(db: Db, ctx: Ctx): Promise<string> {
  const explicit = ctx.companyTimeZone ?? undefined;
  const tz = explicit ?? (await db.dposCompanyBinding.findUnique({ where: { dposCompanyId: ctx.dposCompanyId }, select: { companyTimeZone: true } }))?.companyTimeZone ?? null;
  if (!tz || !isValidIanaTimeZone(tz)) {
    throw new DposError("COMPANY_TIME_ZONE_REQUIRED", "Scoring persistence is counted per company-local operating week (Sunday-Saturday), so the company needs a valid IANA time zone configured.", 409, { companyTimeZone: tz });
  }
  return tz;
}
// ---- the governed scoring run ------------------------------------------------------------------------------------------------

export interface RunScoringInput {
  /** Idempotency key (for example the weekly cycle id): repeating a request with the same key returns the stored run. */
  runKey?: string;
  at?: Date;
  /** References to the input / source runs this scoring run was based on (Data Hub snapshots, IAM source run ids). */
  sourceRefs?: string[];
}

export interface RankedSummary {
  candidateId: string;
  title: string | null;
  domainScore: number;
  displayScore: number;
  priorityBand: string;
  calculatedRank: number;
  displayedRank: number;
  effectiveScore: number;
  top2Qualified: boolean;
  emergencyReviewCandidate: boolean;
  criticalOutsideTop2: boolean;
  forcedReviewRequired: boolean;
}

export interface ScoringRunSummary {
  scoringRunId: string;
  replayed: boolean;
  scoringVersion: string;
  configVersion: string;
  runAt: Date;
  candidatesConsidered: number;
  candidatesRanked: number;
  candidatesExcluded: number;
  resultCount: number;
  top2: string[];
  ranked: RankedSummary[];
  excluded: Array<{ candidateId: string; reason: string; detail?: string }>;
  criticalOutsideTop2: string[];
  emergencyReviewCandidates: string[];
  forcedReviews: Array<{ reviewId: string; candidateId: string; reasonCode: string }>;
  suppressionReReviews: string[];
  events: Array<EmittedEvent & { candidateId: string }>;
}

interface Work {
  candidate: NonNullable<Awaited<ReturnType<Tx["iamCoreCandidate"]["findFirst"]>>>;
  wf: NonNullable<Awaited<ReturnType<Tx["iamCoreWorkflowState"]["findFirst"]>>>;
  resultId: string;
  inputId: string | null;
  inputVersion: number | null;
  inputsHash: string | null;
  inputs: ScoringInputs | null;
  calc: ScoreCalculation | null;
  exclusion: { reason: string; detail?: string } | null;
}

function latestBy<T extends { candidateId: string }>(rows: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) if (!m.has(r.candidateId)) m.set(r.candidateId, r);
  return m;
}

export async function runScoring(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, input: RunScoringInput = {}, cfg: ScoringConfig = SCORING_CONFIG): Promise<ScoringRunSummary> {
  requireSystemOrManagement(actor, "Running scoring");
  assertStableUserId(actor, "Running scoring");
  if (input.runKey !== undefined && !input.runKey.trim()) throw new DposError("RUN_KEY_INVALID", "runKey must not be blank.", 400);
  const companyId = ctx.dposCompanyId;
  const at = input.at ?? new Date();

  const outcome = await db.$transaction(
    async (tx): Promise<{ summary: ScoringRunSummary; signals: Array<{ candidateId: string; becameCritical: boolean; materiallyWorsened: boolean; note: string }> }> => {
      if (input.runKey) {
        const existing = await tx.iamCoreScoringRun.findUnique({ where: { dposCompanyId_runKey: { dposCompanyId: companyId, runKey: input.runKey } } });
        if (existing) return { summary: await summaryFromStoredRun(tx, existing.scoringRunId, true), signals: [] };
      }
      const scoringRunId = randomUUID();
      const hash = configHash(cfg);
      const companyTz = await companyTimeZoneFor(tx, ctx);
      const operatingWeekStart = operatingWeekOf(at, companyTz);

      // ---- 1. the candidate pool: every OPEN canonical candidate of this company ----------------------------------------
      const candidates = await tx.iamCoreCandidate.findMany({ where: { dposCompanyId: companyId, closedAt: null }, orderBy: [{ originalCreatedAt: "asc" }, { candidateId: "asc" }] });
      const ids = candidates.map((c) => c.candidateId);
      const wfRows = await tx.iamCoreWorkflowState.findMany({ where: { candidateId: { in: ids } } });
      const wfById = new Map(wfRows.map((w) => [w.candidateId, w]));
      const inputRows = ids.length ? await tx.iamCoreScoringInput.findMany({ where: { candidateId: { in: ids } }, orderBy: [{ inputVersion: "desc" }] }) : [];
      const inputById = latestBy(inputRows);
      const since = new Date(at.getTime() - 70 * DAY_MS);
      const priorRows = ids.length
        ? await tx.iamCoreScoreResult.findMany({ where: { candidateId: { in: ids }, scoredAt: { gte: since } }, orderBy: { scoredAt: "desc" }, select: { candidateId: true, scoredAt: true, outcome: true, domainScore: true, operatingWeekStart: true } })
        : [];
      const priorByCandidate = new Map<string, PriorOccurrence[]>();
      for (const p of priorRows) {
        const list = priorByCandidate.get(p.candidateId) ?? [];
        list.push({ scoredAt: p.scoredAt, operatingWeekStart: p.operatingWeekStart, qualified: p.outcome === "RANKED" && (p.domainScore ?? 0) >= cfg.persistence.qualifyingMinScore });
        priorByCandidate.set(p.candidateId, list);
      }
      const strategic = await activeStrategic(tx, ids, at);
      const overrides = await activeOverrides(tx, ids, at);
      const locks = await activeLocks(tx, ids, at);

      // A candidate closed by a management decision (rejected, risk accepted, completed) no longer needs its forced reviews or
      // emergency review: the decision itself is the documented resolution (for example risk acceptance of a Critical issue).
      const closedOpenReviews = await tx.iamCoreForcedReview.findMany({ where: { dposCompanyId: companyId, status: "OPEN", candidate: { closedAt: { not: null } } } });
      for (const r of closedOpenReviews) {
        const decision = await tx.iamCoreManagementDecision.findFirst({ where: { candidateId: r.candidateId, decisionType: { in: ["REJECT", "RISK_ACCEPT"] } }, orderBy: { decidedAt: "desc" } });
        await tx.iamCoreForcedReview.update({
          where: { reviewId: r.reviewId },
          data: { status: "RESOLVED", resolvedAt: at, resolvedBy: decision?.actorId ?? "iam-system", resolutionBasis: "CANDIDATE_CLOSED_BY_DECISION", resolution: `The candidate was closed${decision ? ` by a management ${decision.decisionType} decision` : ""}.` },
        });
      }
      const closedEmergencies = await tx.iamCoreEmergencyReview.findMany({ where: { dposCompanyId: companyId, status: { in: ["CANDIDATE", "CONFIRMED"] }, candidate: { closedAt: { not: null } } } });
      for (const e of closedEmergencies) {
        await tx.iamCoreEmergencyReview.update({
          where: { emergencyReviewId: e.emergencyReviewId },
          data: e.status === "CANDIDATE" ? { status: "WITHDRAWN", decidedAt: at, decisionReason: "The candidate was closed." } : { status: "CLEARED", decidedBy: "iam-system", decidedAt: at, decisionReason: "The candidate was closed; the emergency no longer applies." },
        });
      }

      // ---- 2. score every candidate with ONE version/configuration ---------------------------------------------------------
      const seenKeys = new Set<string>();
      // 4C-D2: ONE scoring home per quantified economic amount. The earliest candidate (creation order) that uses an economic identity owns it.
      const economicOwner = new Map<string, string>();
      const work: Work[] = [];
      for (const c of candidates) {
        const wf = wfById.get(c.candidateId);
        const base = { candidate: c, wf: wf!, resultId: randomUUID(), inputId: null as string | null, inputVersion: null as number | null, inputsHash: null as string | null, inputs: null as ScoringInputs | null, calc: null as ScoreCalculation | null };
        if (!wf) {
          work.push({ ...base, exclusion: { reason: "NO_WORKFLOW_RECORD", detail: "The candidate has no Stage 4B workflow record." } });
          continue;
        }
        if (!(POOL_STATES as readonly string[]).includes(wf.workflowState)) {
          work.push({ ...base, exclusion: { reason: "NOT_A_NEW_CANDIDATE", detail: `Workflow state ${wf.workflowState}: assigned/active/completed actions are not part of the new-candidate ranking pool.` } });
          continue;
        }
        if (seenKeys.has(c.groupedConditionKey)) {
          work.push({ ...base, exclusion: { reason: "DUPLICATE_CONDITION", detail: `Another open candidate already represents the grouped condition ${c.groupedConditionKey}.` } });
          continue;
        }
        seenKeys.add(c.groupedConditionKey);
        const inp = inputById.get(c.candidateId);
        if (!inp) {
          work.push({ ...base, exclusion: { reason: "NO_SCORING_INPUTS", detail: "No scoring inputs have been recorded for this candidate." } });
          continue;
        }
        const parsed = validateScoringInputs(parseJson<unknown>(inp.inputsJson, null));
        if (!parsed.ok || !parsed.value) {
          work.push({ ...base, inputId: inp.inputId, inputVersion: inp.inputVersion, inputsHash: inp.inputsHash, exclusion: { reason: "INVALID_SCORING_INPUTS", detail: parsed.issues.join("; ").slice(0, 1500) } });
          continue;
        }
        const attributionIssues: string[] = [];
        for (const a of parsed.value.economicAttribution) {
          const key = economicKey(a);
          const owner = economicOwner.get(key);
          if (a.candidateRef !== undefined && a.candidateRef !== c.candidateId) attributionIssues.push(`${key} is attributed to candidate ${a.candidateRef}, not to this candidate`);
          else if (owner !== undefined && owner !== c.candidateId) attributionIssues.push(`${key} is already attributed to candidate ${owner}`);
        }
        if (attributionIssues.length) {
          work.push({ ...base, inputId: inp.inputId, inputVersion: inp.inputVersion, inputsHash: inp.inputsHash, inputs: parsed.value, exclusion: { reason: "ECONOMIC_AMOUNT_ALREADY_ATTRIBUTED", detail: `The same quantified economic amount cannot earn points twice: ${attributionIssues.join("; ")}.`.slice(0, 1500) } });
          continue;
        }
        for (const a of parsed.value.economicAttribution) economicOwner.set(economicKey(a), c.candidateId);
        const occurrence = occurrenceNumber(priorByCandidate.get(c.candidateId) ?? [], operatingWeekStart, companyTz);
        const auth = strategic.get(c.candidateId);
        const calc = calculateScore(
          parsed.value,
          {
            persistence: { consecutiveQualifiedOccurrences: occurrence, excluded: wf.workflowState === "SUPPRESSED" ? "SUPPRESSED" : null },
            strategic: auth ? { level: auth.level, authorizedBy: auth.authorizedBy, reason: auth.reason } : null,
          },
          cfg,
        );
        const row: Work = { ...base, inputId: inp.inputId, inputVersion: inp.inputVersion, inputsHash: inp.inputsHash, inputs: parsed.value, calc, exclusion: null };
        if (!calc.rankable) row.exclusion = { reason: calc.notRankableReason ?? "NOT_RANKABLE", detail: "Insufficient data confidence: no ranked score is produced; route to data investigation." };
        work.push(row);
      }
      const ranked = work.filter((w) => w.calc?.rankable && !w.exclusion);

      // ---- 3. ranking: calculated order, effective (management) order, rank locks, Top 2 -----------------------------------
      const { groups: manual } = await manualTieBreakGroups(tx, companyId, ranked.map((w) => w.candidate.candidateId));
      const items: RankItem[] = ranked.map((w) => {
        const ov = overrides.get(w.candidate.candidateId);
        const base = w.calc!.domainScore!;
        return {
          candidateId: w.candidate.candidateId,
          domainScore: base,
          effectiveScore: Math.min(100, Math.max(0, Math.round((base + (ov?.points ?? 0)) * 10_000) / 10_000)),
          tie: w.calc!.tieBreak,
          createdAt: w.candidate.originalCreatedAt.toISOString(),
          eligibleForTop2: (TOP2_STATES as readonly string[]).includes(w.wf.workflowState),
        };
      });
      const byId = new Map(items.map((i) => [i.candidateId, i]));
      // 4C-D8: the CALCULATED order is pure calculation (steps 1-12, then the deterministic id fallback); a manual management tie-break only ever shapes the displayed order.
      const calculated = orderItems(items, (i) => i.domainScore, [], cfg);
      const effective = orderItems(items, (i) => i.effectiveScore, manual, cfg);
      const lockApplication = applyRankLocks(effective.order, [...locks.values()].filter((l) => effective.order.includes(l.candidateId)));
      const displayedOrder = lockApplication.displayed;
      const top2 = selectTop2(displayedOrder, byId, cfg);
      const calculatedRankOf = new Map(calculated.order.map((id, i) => [id, i + 1]));
      const displayedRankOf = new Map(displayedOrder.map((id, i) => [id, i + 1]));

      // ---- 4. emergency review candidates (never automatic emergencies) -------------------------------------------------------
      const emergencyIds = work.filter((w) => w.calc?.emergency.candidate).map((w) => w.candidate.candidateId);
      emergencyIds.sort((a, b) => (displayedRankOf.get(a) ?? 1e9) - (displayedRankOf.get(b) ?? 1e9) || (a < b ? -1 : 1));
      const existingEm = ids.length ? await tx.iamCoreEmergencyReview.findMany({ where: { dposCompanyId: companyId, status: { in: ["CANDIDATE", "CONFIRMED"] } } }) : [];
      const confirmedOther = (id: string) => existingEm.some((e) => e.status === "CONFIRMED" && e.candidateId !== id);
      const openEmergency = new Map<string, (typeof existingEm)[number]>();
      for (const e of existingEm) if (e.status === "CANDIDATE" || e.status === "CONFIRMED") openEmergency.set(e.candidateId, e);
      const forcedOpened: Array<{ reviewId: string; candidateId: string; reasonCode: string }> = [];
      const openForced = async (candidateId: string, reasonCode: string, detail: string) => {
        const exists = await tx.iamCoreForcedReview.findFirst({ where: { candidateId, reasonCode, status: "OPEN" } });
        if (exists) return exists;
        const row = await tx.iamCoreForcedReview.create({ data: { dposCompanyId: companyId, candidateId, reasonCode, detail: detail.slice(0, 2000), raisedAt: at, raisedByRunId: scoringRunId } });
        forcedOpened.push({ reviewId: row.reviewId, candidateId, reasonCode });
        return row;
      };
      const resolveForced = async (reviewId: string, by: string, basis: string, resolution: string) => {
        await tx.iamCoreForcedReview.update({ where: { reviewId }, data: { status: "RESOLVED", resolvedAt: at, resolvedBy: by, resolutionBasis: basis, resolution: resolution.slice(0, 2000) } });
      };
      // 4C-D5: one emergency is published normally. Every further qualifying candidate keeps ALL its triggers, is marked "Additional Emergency
      // Review Required" and gets a forced management review; it is never dropped, never auto-published and never suppressed.
      const additionalEmergencyIds = new Set<string>(existingEm.filter((e) => e.status === "CANDIDATE" && e.additionalEmergency).map((e) => e.candidateId));
      let emergencyOrdinal = 0;
      for (const id of emergencyIds) {
        const w = work.find((x) => x.candidate.candidateId === id)!;
        const triggers = w.calc!.emergency.triggers;
        if (openEmergency.has(id)) continue; // an emergency review for this candidate is already open or confirmed
        const additional = confirmedOther(id) || emergencyOrdinal > 0 || [...openEmergency.values()].some((e) => e.candidateId !== id && e.status === "CANDIDATE");
        await tx.iamCoreEmergencyReview.create({ data: { dposCompanyId: companyId, candidateId: id, status: "CANDIDATE", triggersJson: JSON.stringify(triggers), raisedRunId: scoringRunId, raisedAt: at, additionalEmergency: additional } });
        if (additional) additionalEmergencyIds.add(id);
        if (additional) await openForced(id, "ADDITIONAL_EMERGENCY", `Emergency trigger(s) ${triggers.join(", ")} fired while another emergency is already published or under review; forced review required (never silently suppressed).`);
        emergencyOrdinal++;
      }
      // An emergency-review candidate whose triggers no longer fire is withdrawn (a confirmed emergency stays until management clears it).
      for (const e of existingEm.filter((x) => x.status === "CANDIDATE")) {
        const w = work.find((x) => x.candidate.candidateId === e.candidateId);
        if (w && !w.calc?.emergency.candidate) await tx.iamCoreEmergencyReview.update({ where: { emergencyReviewId: e.emergencyReviewId }, data: { status: "WITHDRAWN", decidedAt: at, decisionReason: "The emergency triggers no longer fire in the latest scoring run." } });
      }
      for (const id of [...additionalEmergencyIds]) {
        const w = work.find((x) => x.candidate.candidateId === id);
        if (!w?.calc?.emergency.candidate) additionalEmergencyIds.delete(id);
      }
      // An emergency evaluation (confirmed or declined) satisfies a Critical-outside-Top-2 requirement.
      const decidedEm = ids.length ? await tx.iamCoreEmergencyReview.findMany({ where: { dposCompanyId: companyId, status: { in: ["CONFIRMED", "DECLINED"] } }, orderBy: { decidedAt: "desc" } }) : [];
      const decidedEmBy = latestBy(decidedEm);

      // ---- 5. suppression interaction + prior state ------------------------------------------------------------------------------
      const prevRanked = ids.length ? await tx.iamCoreScoreResult.findMany({ where: { candidateId: { in: ids }, outcome: "RANKED" }, orderBy: { scoredAt: "desc" }, distinct: ["candidateId"] }) : [];
      const prevRankedBy = new Map(prevRanked.map((r) => [r.candidateId, r]));
      const prevPublished = ids.length ? await tx.iamCoreScoreResult.findMany({ where: { candidateId: { in: ids }, publishedEventType: { not: null } }, orderBy: { scoredAt: "desc" }, distinct: ["candidateId"] }) : [];
      const prevPublishedBy = new Map(prevPublished.map((r) => [r.candidateId, r]));
      // 4C-D8: governed display changes published immediately since the last scoring result are the newer "last published" state.
      const displayStates = await latestDisplayStates(tx, ids);
      const signals: Array<{ candidateId: string; becameCritical: boolean; materiallyWorsened: boolean; note: string }> = [];
      const suppressionReReviews: string[] = [];

      // ---- 6. forced reviews + flags ------------------------------------------------------------------------------------------------
      const criticalOutside: string[] = [];
      type Flags = { top2: boolean; criticalOutsideTop2: boolean; emergency: boolean; forcedReviewRequired: boolean; forcedReviewReason: string | null; tieNote: TieNote | null; suppression: Record<string, unknown> | null };
      const flagsById = new Map<string, Flags>();
      for (const w of work) {
        const id = w.candidate.candidateId;
        const calc = w.calc;
        const isRanked = !!calc?.rankable && !w.exclusion;
        let criticalOut = false;
        let suppressionInfo: Record<string, unknown> | null = null;
        if (isRanked && calc) {
          criticalOut = calc.priorityBand === "CRITICAL" && !top2.includes(id);
          if (criticalOut) {
            criticalOutside.push(id);
            const dem = overrides.get(id);
            const emDecided = decidedEmBy.get(id);
            const open = await tx.iamCoreForcedReview.findFirst({ where: { candidateId: id, reasonCode: "CRITICAL_OUTSIDE_TOP2", status: "OPEN" } });
            if (dem && dem.points < 0) {
              if (open) await resolveForced(open.reviewId, dem.by, "DOCUMENTED_DEMOTION", `Documented demotion of ${dem.points} points: ${dem.reason}`);
            } else if (emDecided && emDecided.decidedBy) {
              if (open) await resolveForced(open.reviewId, emDecided.decidedBy, "EMERGENCY_EVALUATED", `Emergency review ${emDecided.status}: ${emDecided.decisionReason ?? ""}`);
            } else if (!open) {
              const resolvedBefore = await tx.iamCoreForcedReview.findFirst({ where: { candidateId: id, reasonCode: "CRITICAL_OUTSIDE_TOP2", status: "RESOLVED" } });
              const prior = prevRankedBy.get(id);
              const continuous = !!prior && prior.priorityBand === "CRITICAL";
              if (!resolvedBefore || !continuous) {
                await openForced(id, "CRITICAL_OUTSIDE_TOP2", `Critical (score ${calc.domainScore!.toFixed(2)}) but outside the Top 2: management review, emergency evaluation, documented demotion or risk acceptance is required.`);
              }
            }
          } else {
            const open = await tx.iamCoreForcedReview.findFirst({ where: { candidateId: id, reasonCode: "CRITICAL_OUTSIDE_TOP2", status: "OPEN" } });
            if (open) await resolveForced(open.reviewId, "iam-system", "NO_LONGER_APPLICABLE", "The candidate is no longer Critical outside the Top 2.");
          }
        }
        // repeated rejection: after 3 qualified rejections of the same condition, forced SENIOR review (workflow history stays authoritative)
        const rejections = await countQualifiedRejections(tx, ctx, w.candidate.groupedConditionKey);
        if (rejections >= cfg.repeatedRejection.threshold) {
          const anyRow = await tx.iamCoreForcedReview.findFirst({ where: { candidateId: id, reasonCode: "REPEATED_REJECTION" } });
          if (!anyRow) await openForced(id, "REPEATED_REJECTION", `${rejections} qualified rejections of this condition: repeated-rejection flag and forced senior review.`);
        }
        if (w.exclusion?.reason === "ECONOMIC_AMOUNT_ALREADY_ATTRIBUTED" && !(await tx.iamCoreForcedReview.findFirst({ where: { candidateId: id, reasonCode: "POSSIBLE_DOUBLE_COUNTING", status: "OPEN" } }))) await openForced(id, "POSSIBLE_DOUBLE_COUNTING", w.exclusion.detail ?? "A quantified economic amount is attributed to more than one candidate.");
        if (w.exclusion?.reason === "INSUFFICIENT_DATA_CONFIDENCE") await openForced(id, "DATA_INVESTIGATION", "Data confidence is insufficient to rank this condition; route to data investigation (or emergency review where warranted).");
        // suppressed candidates are still scored; re-review triggers
        if (w.wf.workflowState === "SUPPRESSED" && calc) {
          const sup = await tx.iamCoreSuppression.findFirst({ where: { candidateId: id, status: "ACTIVE" }, orderBy: { startedAt: "desc" } });
          if (sup) {
            const refRow = await tx.iamCoreScoreResult.findFirst({ where: { candidateId: id, outcome: "RANKED", scoredAt: { lte: sup.startedAt } }, orderBy: { scoredAt: "desc" } });
            const baseline = refRow?.domainScore ?? null;
            const reasons: string[] = [];
            let materially = false;
            let becameCritical = false;
            if (isRanked) {
              if (baseline !== null && calc.domainScore! - baseline >= cfg.suppressionReReview.scoreIncrease) {
                reasons.push(`score increased ${(calc.domainScore! - baseline).toFixed(2)} points since suppression (baseline ${baseline.toFixed(2)})`);
                materially = true;
              }
              if (calc.priorityBand === "CRITICAL" && refRow?.priorityBand !== "CRITICAL") {
                reasons.push("the candidate became Critical");
                becameCritical = true;
              }
            }
            if (calc.emergency.candidate) {
              reasons.push(`emergency trigger(s) ${calc.emergency.triggers.join(", ")} fired`);
              materially = true;
            }
            suppressionInfo = { suppressionId: sup.suppressionId, baselineScore: baseline, triggers: reasons };
            if (reasons.length) {
              await openForced(id, "SUPPRESSION_RE_REVIEW", `Suppressed candidate must be re-reviewed: ${reasons.join("; ")}.`);
              signals.push({ candidateId: id, becameCritical, materiallyWorsened: materially, note: `Scoring re-review trigger: ${reasons.join("; ")}` });
              suppressionReReviews.push(id);
            }
          }
        }
        const stillOpen = await tx.iamCoreForcedReview.findMany({ where: { candidateId: id, status: "OPEN" }, orderBy: { raisedAt: "asc" } });
        flagsById.set(id, {
          top2: top2.includes(id),
          criticalOutsideTop2: criticalOut,
          emergency: !!calc?.emergency.candidate,
          forcedReviewRequired: stillOpen.length > 0,
          forcedReviewReason: stillOpen.length ? [...new Set(stillOpen.map((r) => r.reasonCode))].join(", ") : null,
          tieNote: effective.notes.get(id) ?? calculated.notes.get(id) ?? null,
          suppression: suppressionInfo,
        });
      }

      // ---- 7. persist the run and every result, and publish ---------------------------------------------------------------------------
      const excludedCount = work.length - ranked.length;
      await tx.iamCoreScoringRun.create({
        data: {
          scoringRunId,
          dposCompanyId: companyId,
          runKey: input.runKey ?? null,
          runAt: at,
          scoringVersion: cfg.scoringVersion,
          configVersion: cfg.configVersion,
          configHash: hash,
          configJson: canonicalJson(cfg),
          status: "FINALIZED",
          requestedBy: actor.actorId,
          requestedByRole: actor.role,
          sourceRefsJson: toJson(input.sourceRefs ?? null),
          candidatesConsidered: work.length,
          candidatesRanked: ranked.length,
          candidatesExcluded: excludedCount,
          top2Json: JSON.stringify(top2),
          companyTimeZone: companyTz,
          operatingWeekStart,
          summaryJson: JSON.stringify({
            criticalOutsideTop2: criticalOutside,
            emergencyReviewCandidates: emergencyIds,
            forcedReviewsOpened: forcedOpened,
            suppressionReReviews,
            rankLocks: lockApplication,
            manualTieBreaks: manual,
            economicAttribution: Object.fromEntries([...economicOwner.entries()]),
          }),
        },
      });

      const events: Array<EmittedEvent & { candidateId: string }> = [];
      const orderForWrite = [...work].sort((a, b) => (calculatedRankOf.get(a.candidate.candidateId) ?? 1e9) - (calculatedRankOf.get(b.candidate.candidateId) ?? 1e9) || (a.candidate.candidateId < b.candidate.candidateId ? -1 : 1));
      const rankedSummaries: RankedSummary[] = [];
      const excludedSummaries: ScoringRunSummary["excluded"] = [];
      for (const w of orderForWrite) {
        const id = w.candidate.candidateId;
        const flags = flagsById.get(id)!;
        const calc = w.calc;
        const ov = overrides.get(id) ?? null;
        const lk = locks.get(id) ?? null;
        const calcRank = calculatedRankOf.get(id) ?? null;
        const dispRank = displayedRankOf.get(id) ?? null;
        const prevR = prevRankedBy.get(id) ?? null;
        const prevPub = prevPublishedBy.get(id) ?? null;
        const item = byId.get(id);
        const governance = {
          override: ov ? { points: ov.points, magnitudeClass: ov.magnitudeClass, by: ov.by, role: ov.role, reason: ov.reason, at: ov.at.toISOString(), governanceId: ov.governanceId } : null,
          rankLock: lk ? { rank: lk.rank, until: lk.expiresAt.toISOString(), by: lk.by, reason: lk.reason, governanceId: lk.governanceId, applied: lockApplication.applied.some((a) => a.candidateId === id), ignored: lockApplication.ignored.find((a) => a.candidateId === id) ?? null } : null,
          strategic: strategic.get(id) ? { level: strategic.get(id)!.level, by: strategic.get(id)!.authorizedBy, reason: strategic.get(id)!.reason } : null,
        };
        const exState = w.exclusion ? scoringStateOfExclusion(w.exclusion) : null;
        const additionalEm = additionalEmergencyIds.has(id);
        const nextState: PublishedState = {
          scoringState: exState ? exState.scoringState : "SCORED",
          scoringStateReason: exState ? exState.scoringStateReason : null,
          scoreFlags: w.exclusion ? [] : (calc?.flags ?? []),
          additionalEmergencyReviewRequired: additionalEm,
          domainScore: w.exclusion ? null : calc!.domainScore,
          calculatedRank: calcRank,
          displayedRank: dispRank,
          priorityBand: w.exclusion ? null : calc!.priorityBand,
          top2Qualified: flags.top2,
          emergencyReviewCandidate: flags.emergency,
          criticalOutsideTop2: flags.criticalOutsideTop2,
          forcedReviewRequired: flags.forcedReviewRequired,
          overridePoints: ov?.points ?? null,
          rankLockRank: lk && lockApplication.applied.some((a) => a.candidateId === id) ? lk.rank : null,
        };
        const derivedPrev: PublishedState | null = prevPub ? publishedStateOfResult(prevPub) : null;
        const disp = displayStates.get(id);
        const prevState: PublishedState | null = disp && (!prevPub || disp.createdAt.getTime() >= prevPub.scoredAt.getTime()) ? disp.state : derivedPrev;

        let eventType: "CANDIDATE_SCORED" | "DOMAIN_PRIORITY_CHANGED" | "SCORING_STATE_CHANGED" | null = null;
        let sections: Record<string, Record<string, unknown>> | null = null;
        if (!w.exclusion && calc) {
          eventType = chooseEvent(prevState, nextState);
          if (eventType) {
            sections = scoreSections(cfg.scoringVersion, {
              scoringRunId,
              scoredAt: at,
              calc,
              calculatedRank: calcRank,
              previousCalculatedRank: prevR?.calculatedRank ?? null,
              displayedRank: dispRank,
              top2Qualified: flags.top2,
              emergencyReviewCandidate: flags.emergency,
              criticalOutsideTop2: flags.criticalOutsideTop2,
              forcedReviewRequired: flags.forcedReviewRequired,
              forcedReviewReason: flags.forcedReviewReason,
              override: ov ? { points: ov.points, by: ov.by, reason: ov.reason, at: ov.at } : null,
              lock: lk && nextState.rankLockRank !== null ? { rank: lk.rank, until: lk.expiresAt, by: lk.by, reason: lk.reason } : null,
              additionalEmergencyReviewRequired: additionalEm,
            });
          }
        } else if (exState && chooseUnscoredEvent(prevState, exState)) {
          // 4C-D7: a previously scored candidate that is now excluded / insufficient / not rankable publishes an EXPLICIT scoring state.
          eventType = "SCORING_STATE_CHANGED";
          sections = scoringStateSections(cfg.scoringVersion, { scoringRunId, scoredAt: at, scoringState: exState.scoringState, scoringStateReason: exState.scoringStateReason, calc, emergencyReviewCandidate: flags.emergency, additionalEmergencyReviewRequired: additionalEm, forcedReviewRequired: flags.forcedReviewRequired, forcedReviewReason: flags.forcedReviewReason });
        } else if (calc && (flags.emergency || flags.forcedReviewRequired) && (!prevState || prevState.emergencyReviewCandidate !== flags.emergency || prevState.forcedReviewRequired !== flags.forcedReviewRequired)) {
          eventType = "DOMAIN_PRIORITY_CHANGED";
          sections = flagsOnlySections(cfg.scoringVersion, { scoringRunId, scoredAt: at, calc, emergencyReviewCandidate: flags.emergency, forcedReviewRequired: flags.forcedReviewRequired, forcedReviewReason: flags.forcedReviewReason });
        }

        let outboxId: string | null = null;
        if (eventType && sections) {
          const em = await Emitter.open(tx, ctx, id, actor, at, SCORING_ORIGIN);
          const ev = await em.emit(eventType, sections, w.resultId);
          outboxId = ev.outboxId;
          events.push({ ...ev, candidateId: id });
        }

        const breakdown = {
          scoringVersion: cfg.scoringVersion,
          configVersion: cfg.configVersion,
          configHash: hash,
          calculation: calc,
          governance,
          ranking: item ? { effectiveScore: item.effectiveScore, calculatedRank: calcRank, displayedRank: dispRank, calculatedTieNote: calculated.notes.get(id) ?? null, effectiveTieNote: effective.notes.get(id) ?? null } : null,
          emergency: calc ? { candidate: calc.emergency.candidate, triggers: calc.emergency.triggers, reasons: calc.emergency.reasons, reviewStatus: openEmergency.get(id)?.status ?? null, additionalEmergencyReviewRequired: additionalEm } : null,
          scoringState: exState ?? { scoringState: "SCORED", scoringStateReason: null },
          operatingWeek: { companyTimeZone: companyTz, operatingWeekStart, consecutiveQualifiedOccurrences: calc?.tieBreak.persistence ?? null },
          economicAttribution: w.inputs?.economicAttribution ?? null,
          contextualEvidence: w.inputs?.contextualEvidence ?? null,
          forcedReviews: { required: flags.forcedReviewRequired, reasons: flags.forcedReviewReason },
          suppression: flags.suppression,
          exclusion: w.exclusion,
          inputsHash: w.inputsHash,
        };
        await tx.iamCoreScoreResult.create({
          data: {
            scoreResultId: w.resultId,
            scoringRunId,
            candidateId: id,
            dposCompanyId: companyId,
            groupedConditionKey: w.candidate.groupedConditionKey,
            outcome: w.exclusion ? "EXCLUDED" : "RANKED",
            exclusionReason: w.exclusion?.reason ?? null,
            exclusionDetail: w.exclusion?.detail ?? null,
            inputId: w.inputId,
            inputVersion: w.inputVersion,
            workflowState: w.wf?.workflowState ?? null,
            rawCoreScore: calc?.rawCoreScore ?? null,
            dataConfidence: calc?.confidence.level ?? null,
            confidenceMultiplier: calc?.confidence.multiplier ?? null,
            confidenceAdjustedCoreScore: calc?.confidenceAdjustedCoreScore ?? null,
            uncappedModifierTotal: calc?.uncappedModifierTotal ?? null,
            cappedModifierTotal: calc?.cappedModifierTotal ?? null,
            uncappedDomainScore: w.exclusion ? null : (calc?.uncappedDomainScore ?? null),
            domainScore: w.exclusion ? null : (calc?.domainScore ?? null),
            priorityBand: w.exclusion ? null : (calc?.priorityBand ?? null),
            calculatedRank: calcRank,
            displayedRank: dispRank,
            previousCalculatedRank: prevR?.calculatedRank ?? null,
            effectiveScore: item?.effectiveScore ?? null,
            top2Qualified: flags.top2,
            emergencyReviewCandidate: flags.emergency,
            criticalOutsideTop2: flags.criticalOutsideTop2,
            forcedReviewRequired: flags.forcedReviewRequired,
            breakdownJson: JSON.stringify(breakdown),
            tieBreakJson: JSON.stringify({ values: calc?.tieBreak ?? null, calculated: calculated.notes.get(id) ?? null, effective: effective.notes.get(id) ?? null }),
            operatingWeekStart,
            mathematicalDomainScore: w.exclusion ? null : (calc?.mathematicalDomainScore ?? null),
            scoreFlagsJson: JSON.stringify(w.exclusion ? [] : (calc?.flags ?? [])),
            scoringState: exState ? exState.scoringState : "SCORED",
            scoringStateReason: exState ? exState.scoringStateReason : null,
            publishedScoringState: eventType ? (eventType === "CANDIDATE_SCORED" ? "SCORED" : (exState?.scoringState ?? "SCORED")) : null,
            additionalEmergencyReviewRequired: additionalEm,
            publishedEventType: eventType,
            publishedOutboxId: outboxId,
            scoredAt: at,
          },
        });
        if (w.exclusion) excludedSummaries.push({ candidateId: id, reason: w.exclusion.reason, ...(w.exclusion.detail ? { detail: w.exclusion.detail } : {}) });
        else
          rankedSummaries.push({
            candidateId: id,
            title: w.wf.title,
            domainScore: calc!.domainScore!,
            displayScore: calc!.displayScore!,
            priorityBand: calc!.priorityBand!,
            calculatedRank: calcRank!,
            displayedRank: dispRank!,
            effectiveScore: item!.effectiveScore,
            top2Qualified: flags.top2,
            emergencyReviewCandidate: flags.emergency,
            criticalOutsideTop2: flags.criticalOutsideTop2,
            forcedReviewRequired: flags.forcedReviewRequired,
          });
      }
      await writeAudit(tx, {
        category: "SCORING",
        action: "SCORING_RUN_FINALIZED",
        outcome: "SUCCESS",
        actor: actor.actorId,
        dposCompanyId: companyId,
        subjectType: "IamCoreScoringRun",
        subjectId: scoringRunId,
        detail: { scoringVersion: cfg.scoringVersion, considered: work.length, ranked: ranked.length, excluded: excludedCount, top2, events: events.map((e) => e.eventType) },
        at,
      });
      rankedSummaries.sort((a, b) => a.calculatedRank - b.calculatedRank);
      return {
        summary: {
          scoringRunId,
          replayed: false,
          scoringVersion: cfg.scoringVersion,
          configVersion: cfg.configVersion,
          runAt: at,
          candidatesConsidered: work.length,
          candidatesRanked: ranked.length,
          candidatesExcluded: excludedCount,
          resultCount: work.length,
          top2,
          ranked: rankedSummaries,
          excluded: excludedSummaries,
          criticalOutsideTop2: criticalOutside,
          emergencyReviewCandidates: emergencyIds,
          forcedReviews: forcedOpened,
          suppressionReReviews,
          events,
        },
        signals,
      };
    },
    { maxWait: 15_000, timeout: 120_000 },
  );

  // Suppression re-review: scoring found a trigger, so the suppression ends and the candidate returns to management (Stage 4B workflow).
  for (const s of outcome.signals) {
    await signalConditionChange(db, ctx, SYSTEM_ACTOR, s.candidateId, { becameCritical: s.becameCritical, materiallyWorsened: s.materiallyWorsened || !s.becameCritical, note: s.note, at: new Date(at.getTime() + 1) });
  }
  return outcome.summary;
}

// ---- reading stored runs -----------------------------------------------------------------------------------------------------

async function summaryFromStoredRun(tx: Db, scoringRunId: string, replayed: boolean): Promise<ScoringRunSummary> {
  const run = await tx.iamCoreScoringRun.findUniqueOrThrow({ where: { scoringRunId } });
  const results = await tx.iamCoreScoreResult.findMany({ where: { scoringRunId }, orderBy: [{ calculatedRank: "asc" }, { candidateId: "asc" }] });
  const wf = await tx.iamCoreWorkflowState.findMany({ where: { candidateId: { in: results.map((r) => r.candidateId) } }, select: { candidateId: true, title: true } });
  const titles = new Map(wf.map((w) => [w.candidateId, w.title]));
  const summary = parseJson<{ criticalOutsideTop2?: string[]; emergencyReviewCandidates?: string[]; forcedReviewsOpened?: Array<{ reviewId: string; candidateId: string; reasonCode: string }>; suppressionReReviews?: string[] }>(run.summaryJson, {});
  const ranked = results
    .filter((r) => r.outcome === "RANKED")
    .map((r) => ({
      candidateId: r.candidateId,
      title: titles.get(r.candidateId) ?? null,
      domainScore: r.domainScore!,
      displayScore: Math.floor((Math.round(r.domainScore! * 10_000) + 500) / 1000) / 10,
      priorityBand: r.priorityBand!,
      calculatedRank: r.calculatedRank!,
      displayedRank: r.displayedRank!,
      effectiveScore: r.effectiveScore!,
      top2Qualified: r.top2Qualified,
      emergencyReviewCandidate: r.emergencyReviewCandidate,
      criticalOutsideTop2: r.criticalOutsideTop2,
      forcedReviewRequired: r.forcedReviewRequired,
    }));
  return {
    scoringRunId,
    replayed,
    scoringVersion: run.scoringVersion,
    configVersion: run.configVersion,
    runAt: run.runAt,
    candidatesConsidered: run.candidatesConsidered,
    candidatesRanked: run.candidatesRanked,
    candidatesExcluded: run.candidatesExcluded,
    resultCount: results.length,
    top2: parseJson<string[]>(run.top2Json, []),
    ranked,
    excluded: results.filter((r) => r.outcome === "EXCLUDED").map((r) => ({ candidateId: r.candidateId, reason: r.exclusionReason ?? "", ...(r.exclusionDetail ? { detail: r.exclusionDetail } : {}) })),
    criticalOutsideTop2: summary.criticalOutsideTop2 ?? [],
    emergencyReviewCandidates: summary.emergencyReviewCandidates ?? [],
    forcedReviews: summary.forcedReviewsOpened ?? [],
    suppressionReReviews: summary.suppressionReReviews ?? [],
    events: [],
  };
}

export async function getScoringRun(db: PrismaClient, ctx: Ctx, scoringRunId: string): Promise<ScoringRunSummary> {
  const run = await db.iamCoreScoringRun.findUnique({ where: { scoringRunId } });
  if (!run || run.dposCompanyId !== ctx.dposCompanyId) throw new DposError("SCORING_RUN_NOT_FOUND", "Unknown scoring run.", 404);
  return summaryFromStoredRun(db, scoringRunId, false);
}

/** The stored explanation of a candidate's score (latest run unless a run is named). */
export async function explainScore(db: PrismaClient, ctx: Ctx, candidateId: string, scoringRunId?: string) {
  const row = await db.iamCoreScoreResult.findFirst({
    where: { candidateId, dposCompanyId: ctx.dposCompanyId, ...(scoringRunId ? { scoringRunId } : {}) },
    orderBy: { scoredAt: "desc" },
  });
  if (!row) throw new DposError("SCORE_NOT_FOUND", "No scoring result for this candidate.", 404);
  return {
    scoreResultId: row.scoreResultId,
    scoringRunId: row.scoringRunId,
    candidateId,
    outcome: row.outcome,
    exclusionReason: row.exclusionReason,
    scoringVersion: parseJson<{ scoringVersion?: string }>(row.breakdownJson, {}).scoringVersion ?? SCORING_VERSION,
    configVersion: parseJson<{ configVersion?: string }>(row.breakdownJson, {}).configVersion ?? SCORING_CONFIG_VERSION,
    domainScore: row.domainScore,
    calculatedRank: row.calculatedRank,
    displayedRank: row.displayedRank,
    priorityBand: row.priorityBand,
    breakdown: parseJson<Record<string, unknown>>(row.breakdownJson, {}),
    tieBreak: parseJson<Record<string, unknown>>(row.tieBreakJson, {}),
    publishedEventType: row.publishedEventType,
    scoredAt: row.scoredAt,
  };
}

export { scoreAtLeast, assertActor };
