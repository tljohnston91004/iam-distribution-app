/**
 * Stage 4D: Health Score service - governed evidence in, immutable Health Score history out.
 *
 * `recordHealthEvidence` stores a new version of governed evidence (append-only; identical evidence does not create a version).
 * `calculateHealth` calculates the five components, composes the score with renormalized weights and stores ONE immutable
 * history row per distinct result per company-local review cycle (Sunday-Saturday): old rows are never rewritten or
 * reinterpreted, a repeated request with unchanged results returns the stored row, and a formula change would be a new
 * `healthVersion` rather than a restatement. It never scores candidates and never changes a Stage 4C result.
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "../audit";
import { DposError, type Db } from "../errors";
import { iamOperatingPeriodFor, isValidIanaTimeZone } from "../contract/iam-results-return";
import { canonicalJson, sha256Json } from "../scoring/config";
import { assertStableUserId } from "../scoring/ledger";
import { parseJson } from "../workflow/internal";
import { requireSystemOrManagement, type WorkflowActor } from "../workflow/permissions";
import { type BackorderProvider } from "./backorder";
import { calcActionResolution, calcEfficiency, calcPositionBalance, calcShortage, calcSlowNonmoving, type ActionFact, type ShortageInput } from "./components";
import { composeHealth, type ComponentResult, type CompositeResult } from "./composite";
import { COMPONENT_KEYS, HEALTH_CONFIG, HEALTH_CURVE_STATUS, HEALTH_LABEL_TEXT, HEALTH_VERSION, healthConfigHash, type ComponentKey, type HealthConfig, type HealthLabel } from "./config";
import { validateEvidence, type CompanyFactsEvidence, type EfficiencyEvidence, type HealthEvidenceKind, type PositionBalanceEvidence, type SlowNonmovingEvidence } from "./evidence";

type Ctx = { dposCompanyId: string; companyTimeZone?: string | null };

// ---- evidence -----------------------------------------------------------------------------------------------------------------

export interface RecordEvidenceResult {
  evidenceId: string;
  kind: HealthEvidenceKind;
  evidenceVersion: number;
  unchanged: boolean;
}

export async function recordHealthEvidence(
  db: PrismaClient,
  ctx: Ctx,
  actor: WorkflowActor,
  kind: HealthEvidenceKind,
  rawPayload: unknown,
  opts: { sourceRefs: string[]; asOf?: Date; at?: Date },
): Promise<RecordEvidenceResult> {
  requireSystemOrManagement(actor, "Recording health evidence");
  assertStableUserId(actor, "Recording health evidence");
  const refs = (opts.sourceRefs ?? []).map((r) => (typeof r === "string" ? r.trim() : "")).filter(Boolean);
  if (!refs.length) throw new DposError("HEALTH_EVIDENCE_SOURCE_REQUIRED", "Health evidence must name its governed source (RSE run, Data Hub batch or governed company record).", 400);
  const v = validateEvidence(kind, rawPayload);
  if (!v.ok || !v.value) throw new DposError("HEALTH_EVIDENCE_INVALID", "The health evidence is not valid.", 400, { issues: v.issues });
  if (opts.asOf && Number.isNaN(opts.asOf.getTime())) throw new DposError("HEALTH_EVIDENCE_INVALID", "asOf is not a valid date.", 400);
  const hash = sha256Json({ kind, value: v.value, refs });
  const at = opts.at ?? new Date();
  return db.$transaction(async (tx) => {
    const latest = await tx.iamCoreHealthEvidence.findFirst({ where: { dposCompanyId: ctx.dposCompanyId, kind }, orderBy: { evidenceVersion: "desc" } });
    if (latest && latest.evidenceHash === hash && (latest.asOf?.getTime() ?? null) === (opts.asOf?.getTime() ?? null)) {
      return { evidenceId: latest.evidenceId, kind, evidenceVersion: latest.evidenceVersion, unchanged: true };
    }
    const row = await tx.iamCoreHealthEvidence.create({
      data: {
        dposCompanyId: ctx.dposCompanyId,
        kind,
        evidenceVersion: (latest?.evidenceVersion ?? 0) + 1,
        evidenceJson: canonicalJson(v.value),
        evidenceHash: hash,
        sourceRefsJson: JSON.stringify(refs),
        asOf: opts.asOf ?? null,
        recordedBy: actor.actorId,
        recordedByRole: actor.role,
        recordedAt: at,
      },
    });
    await writeAudit(tx, { category: "HEALTH", action: "HEALTH_EVIDENCE_RECORDED", outcome: "SUCCESS", actor: actor.actorId, dposCompanyId: ctx.dposCompanyId, subjectType: "IamCoreHealthEvidence", subjectId: row.evidenceId, detail: { kind, evidenceVersion: row.evidenceVersion }, at });
    return { evidenceId: row.evidenceId, kind, evidenceVersion: row.evidenceVersion, unchanged: false };
  });
}

interface LoadedEvidence<T> {
  evidenceId: string;
  evidenceVersion: number;
  value: T;
  refs: string[];
  asOf: Date | null;
}

async function latestEvidence<T>(db: Db, companyId: string, kind: HealthEvidenceKind): Promise<LoadedEvidence<T> | null> {
  const row = await db.iamCoreHealthEvidence.findFirst({ where: { dposCompanyId: companyId, kind }, orderBy: { evidenceVersion: "desc" } });
  if (!row) return null;
  return { evidenceId: row.evidenceId, evidenceVersion: row.evidenceVersion, value: JSON.parse(row.evidenceJson) as T, refs: parseJson<string[]>(row.sourceRefsJson, []), asOf: row.asOf };
}

/** The latest governed evidence of each kind (read model for the board and the evidence drill-through). */
export async function readHealthEvidence(db: Db, ctx: Ctx) {
  const out: Record<HealthEvidenceKind, LoadedEvidence<unknown> | null> = { POSITION_BALANCE: null, EFFICIENCY: null, SLOW_NONMOVING: null, COMPANY_FACTS: null };
  for (const k of Object.keys(out) as HealthEvidenceKind[]) out[k] = await latestEvidence<unknown>(db, ctx.dposCompanyId, k);
  return out;
}

// ---- calculation --------------------------------------------------------------------------------------------------------------

async function companyTimeZoneFor(db: Db, ctx: Ctx): Promise<string> {
  const tz = ctx.companyTimeZone ?? (await db.dposCompanyBinding.findUnique({ where: { dposCompanyId: ctx.dposCompanyId }, select: { companyTimeZone: true } }))?.companyTimeZone ?? null;
  if (!tz || !isValidIanaTimeZone(tz)) {
    throw new DposError("COMPANY_TIME_ZONE_REQUIRED", "Health history is kept per company-local review cycle (Sunday-Saturday), so the company needs a valid IANA time zone configured. There is no UTC fallback.", 409, { companyTimeZone: tz });
  }
  return tz;
}

export interface StoredHealth {
  healthScoreId: string;
  healthVersion: string;
  curveStatus: string;
  configHash: string;
  operatingWeekStart: string;
  companyTimeZone: string | null;
  calculatedAt: string;
  status: "CALCULATED" | "NO_COMPONENT_AVAILABLE";
  score: number | null;
  label: HealthLabel | null;
  labelText: string | null;
  availableComponents: number;
  components: ComponentResult[];
  sourceRefs: Record<string, unknown>;
  dataCurrentThrough: string | null;
  requestedBy: string;
}

type HealthRow = NonNullable<Awaited<ReturnType<Db["iamCoreHealthScore"]["findFirst"]>>>;

export function toStoredHealth(row: HealthRow): StoredHealth {
  return {
    healthScoreId: row.healthScoreId,
    healthVersion: row.healthVersion,
    curveStatus: row.curveStatus,
    configHash: row.configHash,
    operatingWeekStart: row.operatingWeekStart,
    companyTimeZone: row.companyTimeZone,
    calculatedAt: row.calculatedAt.toISOString(),
    status: row.status as StoredHealth["status"],
    score: row.score,
    label: (row.label as HealthLabel | null) ?? null,
    labelText: row.label ? HEALTH_LABEL_TEXT[row.label as HealthLabel] ?? row.label : null,
    availableComponents: row.availableComponents,
    components: JSON.parse(row.componentsJson) as ComponentResult[],
    sourceRefs: JSON.parse(row.sourceRefsJson) as Record<string, unknown>,
    dataCurrentThrough: row.dataCurrentThrough ? row.dataCurrentThrough.toISOString() : null,
    requestedBy: row.requestedBy,
  };
}

export interface HealthCalculationInputs {
  position: LoadedEvidence<PositionBalanceEvidence> | null;
  efficiency: LoadedEvidence<EfficiencyEvidence> | null;
  slowNonmoving: LoadedEvidence<SlowNonmovingEvidence> | null;
  facts: LoadedEvidence<CompanyFactsEvidence> | null;
  shortage: ShortageInput | null;
  shortageReason: string | null;
  actions: ActionFact[];
}

/** Pure composition from loaded inputs (used by the service and directly by tests). */
export function calculateHealthFrom(inputs: HealthCalculationInputs, asOf: Date, cfg: HealthConfig = HEALTH_CONFIG): CompositeResult {
  const components: ComponentResult[] = [
    calcPositionBalance(inputs.position?.value ?? null, inputs.position ? [`health-evidence:${inputs.position.evidenceId}`, ...inputs.position.refs] : [], cfg),
    calcEfficiency(inputs.efficiency?.value ?? null, inputs.facts?.value ?? null, inputs.efficiency ? [`health-evidence:${inputs.efficiency.evidenceId}`, ...(inputs.facts ? [`health-evidence:${inputs.facts.evidenceId}`] : []), ...inputs.efficiency.refs] : [], cfg),
    calcSlowNonmoving(inputs.slowNonmoving?.value ?? null, inputs.slowNonmoving ? [`health-evidence:${inputs.slowNonmoving.evidenceId}`, ...inputs.slowNonmoving.refs] : [], cfg),
    calcShortage(inputs.shortage, inputs.facts?.value ?? null, inputs.shortageReason, cfg),
    calcActionResolution(inputs.actions, asOf, cfg),
  ];
  return composeHealth(components, cfg);
}

export interface CalculateHealthOptions {
  at?: Date;
  /** Governed Customer Backorder feed (Stage 4A Data Hub client). Without one, the shortage component is unavailable. */
  backorder?: BackorderProvider | null;
  /** Explicit idempotency key. By default the key is derived from the calculated result within the review cycle. */
  calcKey?: string;
}

export interface CalculateHealthResult {
  health: StoredHealth;
  unchanged: boolean;
  prior: StoredHealth | null;
  change: HealthChange | null;
}

export async function calculateHealth(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, opts: CalculateHealthOptions = {}, cfg: HealthConfig = HEALTH_CONFIG): Promise<CalculateHealthResult> {
  requireSystemOrManagement(actor, "Calculating the Inventory Management Health Score");
  assertStableUserId(actor, "Calculating the Inventory Management Health Score");
  const at = opts.at ?? new Date();
  const companyId = ctx.dposCompanyId;
  const tz = await companyTimeZoneFor(db, ctx);
  const week = iamOperatingPeriodFor(at, tz).start;

  // The Customer Backorder feed is read OUTSIDE the transaction (network); a failure is "unavailable", never zero.
  let shortage: ShortageInput | null = null;
  let shortageReason: string | null = "No governed Customer Backorder feed was supplied to the calculation.";
  if (opts.backorder) {
    const f = await opts.backorder.fetch();
    if (f.ok) {
      shortage = f.input;
      shortageReason = null;
    } else shortageReason = f.reason;
  }

  return db.$transaction(async (tx) => {
    const position = await latestEvidence<PositionBalanceEvidence>(tx, companyId, "POSITION_BALANCE");
    const efficiency = await latestEvidence<EfficiencyEvidence>(tx, companyId, "EFFICIENCY");
    const slowNonmoving = await latestEvidence<SlowNonmovingEvidence>(tx, companyId, "SLOW_NONMOVING");
    const facts = await latestEvidence<CompanyFactsEvidence>(tx, companyId, "COMPANY_FACTS");
    const actionRows = await tx.iamCoreActionTracking.findMany({ where: { dposCompanyId: companyId }, include: { candidate: { select: { groupedConditionKey: true } } } });
    const actions: ActionFact[] = actionRows.map((a) => ({
      candidateId: a.candidateId,
      groupedConditionKey: a.candidate.groupedConditionKey,
      actionStatus: a.actionStatus,
      completedAt: a.completedAt,
      targetResolution: a.targetResolution,
      actionCompletionPct: a.actionCompletionPct,
      conditionReductionPct: a.conditionReductionPct,
      conditionReductionStatus: a.conditionReductionStatus,
    }));
    const composite = calculateHealthFrom({ position, efficiency, slowNonmoving, facts, shortage, shortageReason, actions }, at, cfg);

    const cfgHash = healthConfigHash(cfg);
    const resultDigest = createHash("sha256")
      .update(canonicalJson({ status: composite.status, score: composite.scoreHundredths, components: composite.components, cfgHash, week }))
      .digest("hex");
    let calcKey = opts.calcKey ?? `auto:${week}:${resultDigest.slice(0, 40)}`;
    let existing = await tx.iamCoreHealthScore.findUnique({ where: { dposCompanyId_calcKey: { dposCompanyId: companyId, calcKey } } });
    if (existing && !opts.calcKey) {
      // Idempotence means "the LATEST stored result is already this one". If the same result recurs after a DIFFERENT result (for example a
      // target was added and then removed in one cycle), the older row must not be returned as current: store a new immutable row.
      const latestRow = await tx.iamCoreHealthScore.findFirst({ where: { dposCompanyId: companyId }, orderBy: [{ calculatedAt: "desc" }, { createdAt: "desc" }] });
      if (latestRow && latestRow.healthScoreId !== existing.healthScoreId) {
        const base = calcKey;
        for (let n = 2; ; n++) {
          calcKey = `${base}#${n}`;
          existing = await tx.iamCoreHealthScore.findUnique({ where: { dposCompanyId_calcKey: { dposCompanyId: companyId, calcKey } } });
          if (!existing) break;
          if (existing.healthScoreId === latestRow.healthScoreId) break; // the latest row is a recurrence of this same result
        }
      }
    }
    const priorRow = await tx.iamCoreHealthScore.findFirst({ where: { dposCompanyId: companyId, ...(existing ? { calculatedAt: { lt: existing.calculatedAt } } : {}) }, orderBy: [{ calculatedAt: "desc" }, { createdAt: "desc" }] });
    if (existing) {
      const health = toStoredHealth(existing);
      const prior = priorRow ? toStoredHealth(priorRow) : null;
      return { health, unchanged: true, prior, change: prior ? compareHealth(health, prior) : null };
    }

    const asOfs = [position?.asOf, efficiency?.asOf, slowNonmoving?.asOf, shortage?.asOf].filter((d): d is Date => !!d && !Number.isNaN(d.getTime()));
    const dataCurrentThrough = asOfs.length ? new Date(Math.min(...asOfs.map((d) => d.getTime()))) : null;
    const sourceRefs = {
      evidence: Object.fromEntries(
        ([["POSITION_BALANCE", position], ["EFFICIENCY", efficiency], ["SLOW_NONMOVING", slowNonmoving], ["COMPANY_FACTS", facts]] as const).map(([k, e]) => [k, e ? { evidenceId: e.evidenceId, evidenceVersion: e.evidenceVersion, sourceRefs: e.refs } : null]),
      ),
      backorderFeed: shortage ? { sourceRefs: shortage.sourceRefs, asOf: shortage.asOf.toISOString(), lines: shortage.lines.length } : { unavailableReason: shortageReason },
      actionTracking: { actionsConsidered: actions.length },
    };
    // The calculated instant must never precede the prior row (keeps "latest" unambiguous).
    const calculatedAt = priorRow && priorRow.calculatedAt.getTime() > at.getTime() ? priorRow.calculatedAt : at;
    const row = await tx.iamCoreHealthScore.create({
      data: {
        dposCompanyId: companyId,
        healthVersion: HEALTH_VERSION,
        curveStatus: HEALTH_CURVE_STATUS,
        configHash: cfgHash,
        calcKey,
        operatingWeekStart: week,
        companyTimeZone: tz,
        calculatedAt,
        status: composite.status,
        score: composite.score,
        label: composite.label,
        availableComponents: composite.availableComponents,
        componentsJson: JSON.stringify(composite.components),
        sourceRefsJson: JSON.stringify(sourceRefs),
        dataCurrentThrough,
        requestedBy: actor.actorId,
      },
    });
    await writeAudit(tx, { category: "HEALTH", action: "HEALTH_SCORE_CALCULATED", outcome: "SUCCESS", actor: actor.actorId, dposCompanyId: companyId, subjectType: "IamCoreHealthScore", subjectId: row.healthScoreId, detail: { score: composite.score, label: composite.label, availableComponents: composite.availableComponents, operatingWeekStart: week, curveStatus: HEALTH_CURVE_STATUS }, at });
    const health = toStoredHealth(row);
    const prior = priorRow ? toStoredHealth(priorRow) : null;
    return { health, unchanged: false, prior, change: prior ? compareHealth(health, prior) : null };
  });
}

// ---- reading history and change -----------------------------------------------------------------------------------------------

export async function latestHealthScore(db: Db, ctx: Ctx): Promise<StoredHealth | null> {
  const row = await db.iamCoreHealthScore.findFirst({ where: { dposCompanyId: ctx.dposCompanyId }, orderBy: [{ calculatedAt: "desc" }, { createdAt: "desc" }] });
  return row ? toStoredHealth(row) : null;
}

/** Immutable history, newest first. `operatingWeekStart` selects one review cycle (the board's Analysis Period). */
export async function listHealthHistory(db: Db, ctx: Ctx, opts: { operatingWeekStart?: string; limit?: number } = {}): Promise<StoredHealth[]> {
  const rows = await db.iamCoreHealthScore.findMany({
    where: { dposCompanyId: ctx.dposCompanyId, ...(opts.operatingWeekStart ? { operatingWeekStart: opts.operatingWeekStart } : {}) },
    orderBy: [{ calculatedAt: "desc" }, { createdAt: "desc" }],
    take: opts.limit ?? 52,
  });
  return rows.map(toStoredHealth);
}

export interface ComponentChange {
  key: ComponentKey;
  prior: number | null;
  current: number | null;
  change: number | null;
  availabilityChanged: boolean;
  material: boolean;
}

export interface HealthChange {
  /** False when the two scores were calculated by different formula versions: they are never compared as if equal. */
  comparable: boolean;
  priorHealthScoreId: string;
  priorScore: number | null;
  currentScore: number | null;
  scoreChange: number | null;
  material: boolean;
  labelChanged: boolean;
  priorLabel: HealthLabel | null;
  components: ComponentChange[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function compareHealth(current: StoredHealth, prior: StoredHealth, cfg: HealthConfig = HEALTH_CONFIG): HealthChange {
  const comparable = current.healthVersion === prior.healthVersion;
  const threshold = cfg.materiality.scorePoints;
  const byKey = (h: StoredHealth) => new Map(h.components.map((c) => [c.key, c]));
  const cur = byKey(current);
  const pri = byKey(prior);
  const components: ComponentChange[] = COMPONENT_KEYS.map((key) => {
    const c = cur.get(key);
    const p = pri.get(key);
    const cs = c?.score ?? null;
    const ps = p?.score ?? null;
    const change = comparable && cs !== null && ps !== null ? r2(cs - ps) : null;
    return { key, prior: ps, current: cs, change, availabilityChanged: (c?.available ?? false) !== (p?.available ?? false), material: (change !== null && Math.abs(change) >= threshold) || (c?.available ?? false) !== (p?.available ?? false) };
  });
  const scoreChange = comparable && current.score !== null && prior.score !== null ? r2(current.score - prior.score) : null;
  return {
    comparable,
    priorHealthScoreId: prior.healthScoreId,
    priorScore: prior.score,
    currentScore: current.score,
    scoreChange,
    material: scoreChange !== null && Math.abs(scoreChange) >= threshold,
    labelChanged: current.label !== prior.label,
    priorLabel: prior.label,
    components,
  };
}

/** Change of the latest score against the one before it (null when there is no prior). */
export async function latestHealthChange(db: Db, ctx: Ctx): Promise<{ health: StoredHealth; prior: StoredHealth | null; change: HealthChange | null } | null> {
  const rows = await db.iamCoreHealthScore.findMany({ where: { dposCompanyId: ctx.dposCompanyId }, orderBy: [{ calculatedAt: "desc" }, { createdAt: "desc" }], take: 2 });
  if (!rows.length) return null;
  const health = toStoredHealth(rows[0]!);
  const prior = rows[1] ? toStoredHealth(rows[1]) : null;
  return { health, prior, change: prior ? compareHealth(health, prior) : null };
}
