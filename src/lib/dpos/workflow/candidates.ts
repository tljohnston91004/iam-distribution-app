/**
 * Stage 4B candidate creation from governed evidence, duplicate / recurrence control, evidence attachment and
 * presentation for management decision.
 *
 * A candidate is a grouped management-level condition (see grouping.ts). Creating one never scores, ranks or recommends
 * anything itself: the system recommendation text and the provisional domain score / rank are SUPPLIED by the caller
 * (a later stage owns detection, scoring and recommendation) and are only stored and carried to the Data Hub.
 */
import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "../audit";
import { DposError } from "../errors";
import {
  Emitter,
  assertWorkflowState,
  optionalText,
  countQualifiedRejections,
  raiseDecisionRequired,
  requireText,
  runOperation,
  toJson,
  transition,
  type Ctx,
  type EmittedEvent,
  type OperationResult,
  type Tx,
} from "./internal";
import { deriveGroupedConditionKey, groupEvidence, validateEvidenceItem, type EvidenceGroup, type EvidenceItem } from "./grouping";
import { assertActor, requireSystemOrManagement, type WorkflowActor } from "./permissions";
import { WORKFLOW_POLICY, WORKFLOW_SOURCE_VERSION, type EvidenceKind } from "./vocab";
import { endSuppressionTx, type SuppressionEndTrigger } from "./management";
import { recordRecurrenceOnCreate } from "../closeout/recurrence";
import { classifyCandidate, requireConditionFamily } from "../closeout/family";

/** Everything the caller (a later detection/recommendation stage) supplies about one grouped condition. */
export interface GroupDescription {
  title: string;
  summary?: string;
  category?: string;
  candidateType?: string;
  /** Governed condition-family code (Stage 4E-C4) supplied by the producer of the candidate; free text is refused. Optional. */
  conditionFamily?: string;
  /** The ORIGINAL system recommendation direction. Stored append-only; never rewritten by management. */
  recommendedActionDirection: string;
  /**
   * Scoring and ranking belong to a later stage (4B-D6): Stage 4B neither computes nor carries a domainScore / domainRank, so the
   * system recommendation, the CANDIDATE_CREATED event and the Data Hub state keep them absent / null until that stage.
   */
  priorityBand?: string;
  expectedImpact?: number;
  expectedImpactUnit?: string;
}

export interface ConditionSignal {
  becameCritical?: boolean;
  materiallyWorsened?: boolean;
  /** The condition re-entered after being absent (re-qualified). */
  reEntered?: boolean;
}

export interface IngestInput {
  evidence: EvidenceItem[];
  sourceRunId: string;
  sourceRefreshAttemptId?: string | null;
  iamSourceVersion?: string;
  describe: (group: EvidenceGroup) => GroupDescription;
  /** Optional condition signals keyed by grouped-condition key (suppression / escalation triggers). */
  signals?: Record<string, ConditionSignal>;
  at?: Date;
}

export interface IngestGroupResult {
  groupedConditionKey: string;
  /** DEFERRED_AWAITING_CLOSEOUT: the condition's candidate finished execution but is not formally closed yet (4B-D4); nothing was written. */
  action: "CREATED" | "EVIDENCE_ATTACHED" | "DEFERRED_AWAITING_CLOSEOUT";
  candidateId: string;
  recurrenceOfCandidateId: string | null;
  evidenceAttached: number;
  evidenceAlreadyPresent: number;
  suppressionEnded: SuppressionEndTrigger | null;
  events: EmittedEvent[];
  /** Stage 4E: an uncertain recurrence match (never auto-linked) awaits management review; these are the REQUIRES_REVIEW rows. */
  recurrenceReviewLinkIds?: string[];
}

function validateDescription(d: GroupDescription, key: string) {
  requireText(d.title, "title", 500);
  requireText(d.recommendedActionDirection, "recommendedActionDirection", 4000);
  if (d.conditionFamily !== undefined && d.conditionFamily !== null) requireConditionFamily(d.conditionFamily);
  const forbidden = ["domainScore", "domainRank"].filter((k) => (d as unknown as Record<string, unknown>)[k] !== undefined);
  if (forbidden.length > 0) {
    throw new DposError("SCORE_AND_RANK_NOT_SUPPORTED", `Group ${key}: ${forbidden.join(" and ")} cannot be supplied in Stage 4B; scoring and ranking are a later stage and no placeholder is stored.`, 400, { groupedConditionKey: key });
  }
}

/** Execution finished and validated; the candidate waits for the later outcome / closeout workflow (not formally closed). */
const AWAITING_CLOSEOUT_STATES: readonly string[] = ["COMPLETED_VALIDATED", "COMPLETED_HISTORY"];

/** Attach evidence references (drill-down) to an open candidate. Existing references are skipped, never duplicated. */
export async function attachEvidenceTx(
  tx: Tx,
  candidate: { candidateId: string; groupedConditionKey: string; sourceRunId: string | null },
  items: readonly EvidenceItem[],
  actor: WorkflowActor,
  at: Date,
  sourceRunId: string | null,
): Promise<{ attached: number; alreadyPresent: number }> {
  let attached = 0;
  let alreadyPresent = 0;
  const existing = new Set((await tx.iamCoreCandidateEvidence.findMany({ where: { candidateId: candidate.candidateId }, select: { evidenceRef: true } })).map((e) => e.evidenceRef));
  for (const raw of items) {
    const item = validateEvidenceItem(raw);
    if (deriveGroupedConditionKey(item) !== candidate.groupedConditionKey) {
      throw new DposError(
        "EVIDENCE_GROUP_MISMATCH",
        `Evidence ${item.evidenceRef} belongs to a different grouped condition (condition / action path / department / objective differ); it must form its own candidate.`,
        409,
        { evidenceRef: item.evidenceRef },
      );
    }
    if (existing.has(item.evidenceRef)) {
      alreadyPresent++;
      continue;
    }
    await tx.iamCoreCandidateEvidence.create({
      data: {
        candidateId: candidate.candidateId,
        evidenceRef: item.evidenceRef,
        kind: (item.kind ?? inferKind(item)) as EvidenceKind,
        sku: item.sku ?? null,
        vendor: item.vendor ?? null,
        category: item.category ?? null,
        poRef: item.poRef ?? null,
        backorderRef: item.backorderRef ?? null,
        sourceRunId: item.sourceRunId ?? sourceRunId ?? candidate.sourceRunId,
        detailJson: toJson(item.detail),
        attachedAt: at,
        attachedBy: actor.actorId,
      },
    });
    existing.add(item.evidenceRef);
    attached++;
  }
  return { attached, alreadyPresent };
}

function inferKind(item: EvidenceItem): EvidenceKind {
  if (item.sku) return "SKU";
  if (item.poRef) return "PURCHASE_ORDER";
  if (item.backorderRef) return "CUSTOMER_BACKORDER";
  if (item.vendor) return "VENDOR";
  if (item.category) return "CATEGORY";
  return "OTHER";
}

interface CreateTxInput {
  group: EvidenceGroup;
  description: GroupDescription;
  sourceRunId: string;
  sourceRefreshAttemptId: string | null;
  iamSourceVersion: string;
  recurrenceOfCandidateId: string | null;
  recurrenceReason: string | null;
  actor: WorkflowActor;
  at: Date;
}

async function createCandidateTx(tx: Tx, ctx: Ctx, input: CreateTxInput): Promise<{ candidateId: string; recurrenceOf: string | null; attached: number; events: EmittedEvent[]; reviewLinkIds: string[] }> {
  const { group, description, actor, at } = input;
  const refs = group.items.map((i) => i.evidenceRef);
  const priorRejections = await countQualifiedRejections(tx, ctx, group.groupedConditionKey);
  const flagged = priorRejections >= WORKFLOW_POLICY.repeatedRejectionThreshold;

  const candidate = await tx.iamCoreCandidate.create({
    data: {
      dposCompanyId: ctx.dposCompanyId,
      groupedConditionKey: group.groupedConditionKey,
      groupedConditionJson: toJson({ facets: group.facets, evidenceCount: refs.length }),
      sourceRunId: input.sourceRunId,
      sourceRefreshAttemptId: input.sourceRefreshAttemptId,
      sourceEvidenceRefsJson: toJson(refs),
      lifecycleState: "CANDIDATE",
      recurrenceOfCandidateId: input.recurrenceOfCandidateId,
      originalCreatedAt: at,
    },
  });
  if (description.conditionFamily) {
    await classifyCandidate(tx, ctx, { candidateId: candidate.candidateId, familyCode: description.conditionFamily, source: "PRODUCER", classifiedBy: actor.actorId, at });
  }
  await tx.iamCoreWorkflowState.create({
    data: {
      candidateId: candidate.candidateId,
      dposCompanyId: ctx.dposCompanyId,
      workflowState: "NEW_CANDIDATE",
      groupedConditionKey: group.groupedConditionKey,
      title: description.title.trim(),
      category: optionalText(description.category, "category", 500),
      candidateType: optionalText(description.candidateType, "candidateType", 500),
      priorQualifiedRejections: priorRejections,
      repeatedRejectionFlag: flagged,
      seniorReviewRequired: flagged,
    },
  });
  await tx.iamCoreWorkflowHistory.create({
    data: {
      candidateId: candidate.candidateId,
      dposCompanyId: ctx.dposCompanyId,
      fromState: null,
      toState: "NEW_CANDIDATE",
      operation: input.recurrenceOfCandidateId ? "CANDIDATE_CREATED_AS_RECURRENCE" : "CANDIDATE_CREATED",
      actorId: actor.actorId,
      actorRole: actor.role,
      reason: input.recurrenceReason,
      detailJson: toJson({ evidenceCount: refs.length, recurrenceOfCandidateId: input.recurrenceOfCandidateId, priorQualifiedRejections: priorRejections }),
      at,
    },
  });
  const rec = await tx.iamCoreSystemRecommendation.create({
    data: {
      candidateId: candidate.candidateId,
      recommendationVersion: 1,
      recommendedAt: at,
      recommendedActionDirection: description.recommendedActionDirection.trim(),
      title: description.title.trim(),
      summary: optionalText(description.summary, "summary"),
      supportingEvidenceRefsJson: toJson(refs),
      recommendationJson: toJson({ priorityBand: description.priorityBand ?? null, expectedImpact: description.expectedImpact ?? null, expectedImpactUnit: description.expectedImpactUnit ?? null }),
      recommendedBy: actor.actorId,
    },
  });
  const { attached } = await attachEvidenceTx(tx, candidate, group.items, actor, at, input.sourceRunId);

  const em = await Emitter.open(tx, ctx, candidate.candidateId, actor, at);
  await em.emit(
    "CANDIDATE_CREATED",
    {
      subject: {
        domainKey: (optionalText(description.category, "category", 500) ?? group.facets.conditionKey).slice(0, 500),
        candidateKind: optionalText(description.candidateType, "candidateType", 500) ?? undefined,
        title: description.title.trim(),
        recommendationVersion: rec.recommendationVersion,
      },
      source: { iamSourceRunId: input.sourceRunId, iamSourceVersion: input.iamSourceVersion, evidenceRefs: refs.slice(0, 100) },
      recommendation: {
        title: description.title.trim(),
        recommendedAction: description.recommendedActionDirection.trim(),
        recommendationSummary: optionalText(description.summary, "summary") ?? undefined,
        priorityBand: description.priorityBand,
        expectedImpact: description.expectedImpact,
        expectedImpactUnit: description.expectedImpactUnit,
      },
    },
    candidate.candidateId,
  );
  // Stage 4E: an exact grouped-condition match links automatically (and records the chain position and the prior closeout context);
  // a weaker match is recorded for management review and links nothing.
  const recurrence = await recordRecurrenceOnCreate(tx, ctx, {
    candidateId: candidate.candidateId,
    groupedConditionKey: group.groupedConditionKey,
    conditionKey: group.facets.conditionKey,
    evidenceRefs: refs,
    exactPriorCandidateId: input.recurrenceOfCandidateId,
    reason: input.recurrenceReason,
    at,
  });
  if (input.recurrenceOfCandidateId && recurrence.eventFields) {
    await em.emit("RECURRENCE_LINKED", { recurrence: recurrence.eventFields }, candidate.candidateId);
  }
  await writeAudit(tx, {
    category: "WORKFLOW",
    action: input.recurrenceOfCandidateId ? "CANDIDATE_CREATED_AS_RECURRENCE" : "CANDIDATE_CREATED",
    outcome: "SUCCESS",
    actor: actor.actorId,
    dposCompanyId: ctx.dposCompanyId,
    subjectType: "IamCoreCandidate",
    subjectId: candidate.candidateId,
    detail: { groupedConditionKey: group.groupedConditionKey, evidence: refs.length, recurrenceOf: input.recurrenceOfCandidateId },
    at,
  });
  return { candidateId: candidate.candidateId, recurrenceOf: input.recurrenceOfCandidateId, attached, events: em.results, reviewLinkIds: recurrence.reviewLinkIds };
}

function mapUnique(e: unknown): never {
  if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") {
    throw new DposError("CANDIDATE_ALREADY_OPEN", "An open candidate already exists for this grouped condition (concurrent creation); retry to attach the evidence to it.", 409);
  }
  throw e;
}

/**
 * Create candidates from governed evidence, or attach the evidence to the candidate that is already open for the same
 * grouped condition. Never one candidate per SKU: evidence is grouped first. A condition whose earlier candidate is
 * CLOSED returns as a NEW candidate linked to it (recurrence); a closed candidate is never reopened.
 */
export async function ingestGovernedEvidence(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, input: IngestInput): Promise<{ groups: IngestGroupResult[] }> {
  assertActor(actor);
  requireSystemOrManagement(actor, "Creating candidates from governed evidence");
  const sourceRunId = requireText(input.sourceRunId, "sourceRunId", 500);
  const groups = groupEvidence(input.evidence);
  const at = input.at ?? new Date();
  const version = input.iamSourceVersion ?? WORKFLOW_SOURCE_VERSION;
  try {
    return await db.$transaction(
      async (tx) => {
        const results: IngestGroupResult[] = [];
        for (const group of groups) {
          const open = await tx.iamCoreCandidate.findFirst({ where: { dposCompanyId: ctx.dposCompanyId, groupedConditionKey: group.groupedConditionKey, closedAt: null } });
          if (open) {
            const openWf = await tx.iamCoreWorkflowState.findUnique({ where: { candidateId: open.candidateId } });
            if (openWf && AWAITING_CLOSEOUT_STATES.includes(openWf.workflowState)) {
              results.push({ groupedConditionKey: group.groupedConditionKey, action: "DEFERRED_AWAITING_CLOSEOUT", candidateId: open.candidateId, recurrenceOfCandidateId: open.recurrenceOfCandidateId, evidenceAttached: 0, evidenceAlreadyPresent: 0, suppressionEnded: null, events: [] });
              continue;
            }
            const { attached, alreadyPresent } = await attachEvidenceTx(tx, open, group.items, actor, at, sourceRunId);
            let ended: SuppressionEndTrigger | null = null;
            const events: EmittedEvent[] = [];
            const signal = input.signals?.[group.groupedConditionKey];
            if (signal) {
              const wf = await tx.iamCoreWorkflowState.findUniqueOrThrow({ where: { candidateId: open.candidateId } });
              const trigger: SuppressionEndTrigger | null = signal.becameCritical ? "BECAME_CRITICAL" : signal.materiallyWorsened ? "MATERIALLY_WORSENED" : signal.reEntered ? "RE_ENTERED" : null;
              if (trigger && wf.workflowState === "SUPPRESSED") {
                const em = await Emitter.open(tx, ctx, open.candidateId, actor, at);
                ended = await endSuppressionTx({ tx, ctx, actor, em, at }, open, wf, trigger, `Condition signal received while suppressed: ${trigger}`);
                events.push(...em.results);
              } else if (trigger === "MATERIALLY_WORSENED" && wf.workflowState === "ACTIVE_ACTION") {
                const em = await Emitter.open(tx, ctx, open.candidateId, actor, at);
                await raiseDecisionRequired({ tx, ctx, actor, em, at }, open.candidateId, "CONDITION_WORSENED", "New governed evidence shows the condition materially worsened.");
                events.push(...em.results);
              }
            }
            results.push({ groupedConditionKey: group.groupedConditionKey, action: "EVIDENCE_ATTACHED", candidateId: open.candidateId, recurrenceOfCandidateId: open.recurrenceOfCandidateId, evidenceAttached: attached, evidenceAlreadyPresent: alreadyPresent, suppressionEnded: ended, events });
            continue;
          }
          const description = input.describe(group);
          validateDescription(description, group.groupedConditionKey);
          const prior = await tx.iamCoreCandidate.findFirst({
            where: { dposCompanyId: ctx.dposCompanyId, groupedConditionKey: group.groupedConditionKey, closedAt: { not: null } },
            orderBy: { closedAt: "desc" },
          });
          const created = await createCandidateTx(tx, ctx, {
            group,
            description,
            sourceRunId,
            sourceRefreshAttemptId: input.sourceRefreshAttemptId ?? null,
            iamSourceVersion: version,
            recurrenceOfCandidateId: prior?.candidateId ?? null,
            recurrenceReason: prior ? `The condition returned after candidate ${prior.candidateId} (${prior.lifecycleState}) was closed.` : null,
            actor,
            at,
          });
          results.push({ groupedConditionKey: group.groupedConditionKey, action: "CREATED", candidateId: created.candidateId, recurrenceOfCandidateId: created.recurrenceOf, evidenceAttached: created.attached, evidenceAlreadyPresent: 0, suppressionEnded: null, events: created.events, ...(created.reviewLinkIds.length ? { recurrenceReviewLinkIds: created.reviewLinkIds } : {}) });
        }
        return { groups: results };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  } catch (e) {
    return mapUnique(e);
  }
}

/**
 * Explicitly create the recurrence of a CLOSED candidate (the returning condition becomes a new candidate linked to the
 * closed one). The evidence must resolve to the same grouped condition.
 */
export async function createRecurrence(
  db: PrismaClient,
  ctx: Ctx,
  actor: WorkflowActor,
  input: { priorCandidateId: string; evidence: EvidenceItem[]; sourceRunId: string; describe: (group: EvidenceGroup) => GroupDescription; reason?: string; iamSourceVersion?: string; at?: Date },
): Promise<IngestGroupResult> {
  assertActor(actor);
  requireSystemOrManagement(actor, "Creating a recurrence");
  const at = input.at ?? new Date();
  const groups = groupEvidence(input.evidence);
  try {
    return await db.$transaction(async (tx) => {
      const prior = await tx.iamCoreCandidate.findUnique({ where: { candidateId: input.priorCandidateId } });
      if (!prior || prior.dposCompanyId !== ctx.dposCompanyId) throw new DposError("CANDIDATE_NOT_FOUND", "Unknown prior candidate.", 404);
      if (!prior.closedAt) throw new DposError("RECURRENCE_TARGET_NOT_CLOSED", "A recurrence can only follow a CLOSED candidate; an open candidate takes new evidence instead.", 409);
      if (groups.length !== 1 || groups[0]!.groupedConditionKey !== prior.groupedConditionKey) {
        throw new DposError("RECURRENCE_CONDITION_MISMATCH", "The recurrence evidence must resolve to exactly the grouped condition of the closed candidate.", 409);
      }
      const open = await tx.iamCoreCandidate.findFirst({ where: { dposCompanyId: ctx.dposCompanyId, groupedConditionKey: prior.groupedConditionKey, closedAt: null } });
      if (open) throw new DposError("CANDIDATE_ALREADY_OPEN", "An open candidate already exists for this grouped condition.", 409, { candidateId: open.candidateId });
      const group = groups[0]!;
      const description = input.describe(group);
      validateDescription(description, group.groupedConditionKey);
      const created = await createCandidateTx(tx, ctx, {
        group,
        description,
        sourceRunId: requireText(input.sourceRunId, "sourceRunId", 500),
        sourceRefreshAttemptId: null,
        iamSourceVersion: input.iamSourceVersion ?? WORKFLOW_SOURCE_VERSION,
        recurrenceOfCandidateId: prior.candidateId,
        recurrenceReason: optionalText(input.reason, "reason") ?? `The condition returned after candidate ${prior.candidateId} was closed.`,
        actor,
        at,
      });
      return { groupedConditionKey: group.groupedConditionKey, action: "CREATED" as const, candidateId: created.candidateId, recurrenceOfCandidateId: prior.candidateId, evidenceAttached: created.attached, evidenceAlreadyPresent: 0, suppressionEnded: null, events: created.events };
    });
  } catch (e) {
    return mapUnique(e);
  }
}

/** Attach more governed evidence to an OPEN candidate (drill-down only). Meaningless for the Data Hub: no event is sent. */
export async function attachEvidence(
  db: PrismaClient,
  ctx: Ctx,
  actor: WorkflowActor,
  candidateId: string,
  input: { evidence: EvidenceItem[]; sourceRunId?: string; at?: Date },
): Promise<OperationResult<{ attached: number; alreadyPresent: number }>> {
  requireSystemOrManagement(actor, "Attaching evidence");
  return runOperation(db, ctx, actor, candidateId, { operation: "EVIDENCE_ATTACHED", at: input.at }, async ({ tx, candidate, wf, at }) => {
    if (AWAITING_CLOSEOUT_STATES.includes(wf.workflowState)) {
      throw new DposError("CANDIDATE_AWAITING_CLOSEOUT", "Execution is complete; this candidate takes no further evidence while it waits for the later outcome / closeout workflow.", 409);
    }
    const r = await attachEvidenceTx(tx, candidate, input.evidence, actor, at, input.sourceRunId ?? null);
    return { attached: r.attached, alreadyPresent: r.alreadyPresent };
  });
}

/** New Candidate -> Presented for Management Decision. Local workflow step (the Data Hub still sees a CANDIDATE). */
export async function presentCandidate(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, candidateId: string, input: { at?: Date } = {}) {
  requireSystemOrManagement(actor, "Presenting a candidate for management decision");
  return runOperation(db, ctx, actor, candidateId, { operation: "PRESENTED_FOR_DECISION", at: input.at }, async ({ tx, wf, at }) => {
    assertWorkflowState(wf, ["NEW_CANDIDATE"], "Presenting for management decision");
    await transition(tx, wf, "PRESENTED", {
      operation: "PRESENTED_FOR_DECISION",
      actor,
      at,
      patch: { presentedAt: at, presentationCount: { increment: 1 }, reReviewRequired: false },
    });
    return {};
  });
}

/** Read helper used by tests and the later Decision Board: the evidence references of a candidate. */
export async function listEvidence(db: PrismaClient, ctx: Ctx, candidateId: string) {
  const c = await db.iamCoreCandidate.findUnique({ where: { candidateId } });
  if (!c || c.dposCompanyId !== ctx.dposCompanyId) throw new DposError("CANDIDATE_NOT_FOUND", "Unknown candidate.", 404);
  return db.iamCoreCandidateEvidence.findMany({ where: { candidateId }, orderBy: { evidenceRef: "asc" } });
}