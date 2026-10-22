/**
 * Stage 4D-R: the governed RSE results read for the Health components Position & Balance, Efficiency and Slow / Nonmoving.
 *
 *   RSE governed result -> Data Hub (Results Return) -> Data Hub governed read -> THIS client mapping -> IAM Health evidence.
 *
 * IAM never reads the RSE database, RSE files or Keystroke files for these components. RSE stays authoritative for Min, Max,
 * classification, demand and replenishment: this module only MAPS governed values onto the existing evidence shapes. It does not
 * recompute weighted demand, business importance, Standard/Matrix class logic, protected N, E retention, closeout precedence or
 * Min/Max. The only IAM-side rule is the PROVISIONAL slow-moving age window below (RSE governs no slow-moving threshold).
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "../audit";
import { FRESHNESS_POLICY } from "../board/freshness";
import { DataHubClientError } from "../data-hub-client";
import type { WorkflowActor } from "../workflow/permissions";
import type { EfficiencyEvidence, HealthEvidenceKind, NaturalSellThroughSource, PositionBalanceEvidence, SlowNonmovingEvidence } from "./evidence";
import { recordHealthEvidence } from "./service";

// ---- the governed Data Hub view (mirrors services/data-hub/src/domain/iam-rse-health-read.ts) ---------------------------------

export const RSE_HEALTH_CONTRACT_PIN = {
  contractId: "IAM_RSE_HEALTH_INPUT_V1",
  contractVersion: "1.1.0",
  contractHash: "fae86268a049da9a5c1d296e484bab600a5d9353eb22ef1956787c2c73080bca",
} as const;

export interface RseClassRow {
  classCode: string;
  skuCount: number | null;
  salesDollars: number | null;
  grossProfitDollars: number | null;
  inventoryValue: number | null;
  impliedTurns: number | null;
  belowMinCount: number | null;
  aboveMaxCount: number | null;
  dataGapCount: number | null;
  underDollars: number | null;
  overDollars: number | null;
}

export interface RseResultView {
  status: "AVAILABLE";
  resultsReturnEventId: string;
  producerEventId: string;
  contractId: string;
  contractVersion: string;
  providerMode: string | null;
  sourceRunId: string | null;
  producerEventAt: string;
  receivedAt: string | null;
  receiptStatus: "ACCEPTED";
  payloadHash: string;
  snapshotVersion: number | null;
  salesDollarLabel: string | null;
  itemScope: string | null;
  locationScope: string | null;
  catalog: {
    skuCount: number | null;
    inventoryValue: number | null;
    underDollars: number | null;
    overDollars: number | null;
    impliedTurns: number | null;
    belowMinCount: number | null;
    aboveMaxCount: number | null;
    dataGapCount: number | null;
  };
  classificationByClass: RseClassRow[];
  fParkedCash: number | null;
  dOverMaxCash: number | null;
}

export interface AgingBand {
  band: string;
  minDays: number | null;
  maxDays: number | null;
  skuCount: number;
  inventoryValue: number;
  sellThrough: {
    protectedValue: number;
    valueWithDemandEvidence: number;
    valueWithoutDemandEvidence: number;
    governedRse: { protectedValue: number; valueWithEvidence: number };
    recentSalesFallback: { protectedValue: number; valueWithEvidence: number };
  };
}

export interface RseHealthInputView {
  companyId: string;
  contractId: string;
  contractVersion: string;
  contractHash: string;
  generatedAt: string;
  rseResult: RseResultView | { status: "NOT_AVAILABLE"; reason: string };
  aging:
    | {
        status: "AVAILABLE";
        positionsAsOf: string;
        locationScope: string;
        positionsConsidered: number;
        positionsWithValue: number;
        positionsWithoutCost: number;
        positionsExcludedOlderExtract: number;
        totalInventoryValue: number;
        bands: AgingBand[];
        sourceImportBatchIds: string[];
        rule: string;
      }
    | { status: "NOT_AVAILABLE"; reason: string };
  rseDemand:
    | { status: "AVAILABLE"; sourceFields: string[]; derivation: string; sourceRunId: string; lineEventsRead: number; itemsWithGovernedDemand: number }
    | { status: "NOT_AVAILABLE"; reason: string };
  sellThrough:
    | { status: "AVAILABLE"; horizonDays: number; salesPeriodEndMax: string | null; itemsWithDemandEvidence: number; itemsWithoutDemandEvidence: number; basis: string }
    | { status: "NOT_AVAILABLE"; horizonDays: number; reason: string };
  coherence: {
    sameSourceRun: false;
    domains: Array<{ domain: string; asOf: string | null; reference: string | null }>;
    positionsVersusRseSkewDays: number | null;
    note: string;
  };
  quality: { notes: string[] };
}

export interface RseHealthProvider {
  fetch(): Promise<RseHealthInputView>;
}

/** Validates the response against the pinned contract; any mismatch is refused (a contract change must be re-pinned on purpose). */
export function assertPinnedContract(view: Partial<RseHealthInputView> | null | undefined): asserts view is RseHealthInputView {
  if (!view || typeof view !== "object") throw new DataHubClientError("DATA_VALIDATION", "RSE_HEALTH_EMPTY", "Data Hub returned no RSE health input view.");
  if (view.contractId !== RSE_HEALTH_CONTRACT_PIN.contractId) throw new DataHubClientError("DATA_VALIDATION", "RSE_HEALTH_CONTRACT_ID", `Unexpected contract ${String(view.contractId)}.`);
  if (view.contractVersion !== RSE_HEALTH_CONTRACT_PIN.contractVersion) throw new DataHubClientError("DATA_VALIDATION", "RSE_HEALTH_CONTRACT_VERSION", `Contract version ${String(view.contractVersion)} is not the pinned ${RSE_HEALTH_CONTRACT_PIN.contractVersion}; re-pin IAM after reviewing the change.`);
  if (view.contractHash !== RSE_HEALTH_CONTRACT_PIN.contractHash) throw new DataHubClientError("DATA_VALIDATION", "RSE_HEALTH_CONTRACT_HASH", "The Data Hub contract hash differs from the IAM pin; re-pin IAM after reviewing the change.");
}

// ---- PROVISIONAL IAM rule (the only rule IAM adds) ----------------------------------------------------------------------------

/**
 * PROVISIONAL (PO decision pending): RSE governs a zero-sales class (F) but no slow-moving definition. Until the Product Owner
 * decides, IAM treats inventory whose last sale was 91-180 days before the inventory as-of date as SLOW (the raw bands come from
 * Data Hub), and inventory in RSE class F as NONMOVING (RSE-governed). The window is data, never hard-wired into the calculators.
 */
export const RSE_INPUT_RULES = {
  ruleId: "IAM_RSE_HEALTH_INPUT_RULES_V1",
  provisional: true,
  slowBands: ["D091_120", "D121_150", "D151_180"] as readonly string[],
  slowWindowText: "last sale 91-180 days before the inventory as-of date",
  nonMovingClassCode: "F",
  naturalSellThroughHorizonDays: 90,
} as const;
export type RseInputRules = typeof RSE_INPUT_RULES;

export const RSE_INPUT_RULES_HASH = createHash("sha256").update(JSON.stringify(RSE_INPUT_RULES)).digest("hex");

// ---- freshness (deterministic boundaries) -------------------------------------------------------------------------------------

export type EvidenceFreshnessState = "CURRENT" | "AGING" | "STALE" | "UNAVAILABLE";
export const EVIDENCE_FRESHNESS_LABELS: Record<EvidenceFreshnessState, string> = { CURRENT: "Current", AGING: "Aging", STALE: "Stale", UNAVAILABLE: "Unavailable" };
const DAY_MS = 24 * 3600 * 1000;

/**
 * Evidence age = elapsed time since the governed data's as-of (RSE producer time, or the oldest contributing source) in exact days.
 * 0 to 8 days inclusive = Current; more than 8 up to 14 days inclusive = Aging; more than 14 days = Stale. Configurable through
 * FRESHNESS_POLICY (data, PO decision 4D-D4). A future as-of is treated as age 0.
 */
export function classifyEvidenceFreshness(asOf: Date | string | null | undefined, now: Date, policy: { currentMaxDays: number; agingMaxDays: number } = FRESHNESS_POLICY): { state: EvidenceFreshnessState; ageDays: number | null } {
  if (!asOf) return { state: "UNAVAILABLE", ageDays: null };
  const t = asOf instanceof Date ? asOf.getTime() : Date.parse(asOf);
  if (Number.isNaN(t)) return { state: "UNAVAILABLE", ageDays: null };
  const ageMs = Math.max(0, now.getTime() - t);
  const state: EvidenceFreshnessState = ageMs <= policy.currentMaxDays * DAY_MS ? "CURRENT" : ageMs <= policy.agingMaxDays * DAY_MS ? "AGING" : "STALE";
  return { state, ageDays: Math.round((ageMs / DAY_MS) * 100) / 100 };
}

/**
 * Source skew (4DR source-skew diagnostics): the RSE management snapshot and the canonical inventory / sales facts are SEPARATE
 * governed sources, not one atomic run. The differences between their business times are exposed for diagnosis. No tolerance is
 * governed, so none is applied here: the skew never blocks, warns or changes a score. Governance of a tolerance is requested.
 */
export function skewDiagnostics(t: { rseSnapshotProducerEventAt: string | null; inventoryPositionAsOf: string | null; salesPeriodEnd: string | null }) {
  const d = (a: string | null, b: string | null): number | null => {
    if (!a || !b) return null;
    const x = Date.parse(a);
    const y = Date.parse(b);
    return Number.isNaN(x) || Number.isNaN(y) ? null : Math.round(((x - y) / DAY_MS) * 10) / 10;
  };
  return {
    inventoryAsOfMinusRseSnapshotDays: d(t.inventoryPositionAsOf, t.rseSnapshotProducerEventAt),
    salesPeriodEndMinusRseSnapshotDays: d(t.salesPeriodEnd, t.rseSnapshotProducerEventAt),
    salesPeriodEndMinusInventoryAsOfDays: d(t.salesPeriodEnd, t.inventoryPositionAsOf),
    toleranceGoverned: false as const,
    tolerance: null,
    note: "Diagnostic only. No skew tolerance is governed; future governance is requested. Sources are separate and not guaranteed to be one run.",
  };
}
// ---- mapping ------------------------------------------------------------------------------------------------------------------

export interface MappedEvidence<T> {
  payload: T | null;
  sourceRefs: string[];
  asOf: Date | null;
  /** Why the component cannot be supplied (never zero). */
  unavailableReason: string | null;
}
export interface MappedRseHealth {
  position: MappedEvidence<PositionBalanceEvidence>;
  efficiency: MappedEvidence<EfficiencyEvidence>;
  slowNonmoving: MappedEvidence<SlowNonmovingEvidence>;
  notes: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const fin = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const none = <T>(reason: string): MappedEvidence<T> => ({ payload: null, sourceRefs: [], asOf: null, unavailableReason: reason });

function sourceContext(view: RseHealthInputView, rse: RseResultView) {
  return {
    system: "RSE governed result via Data Hub Results Return",
    iamReadContract: { id: view.contractId, version: view.contractVersion, hash: view.contractHash },
    resultsReturnContract: { id: rse.contractId, version: rse.contractVersion },
    resultsReturnEventId: rse.resultsReturnEventId,
    producerEventId: rse.producerEventId,
    sourceRunId: rse.sourceRunId,
    providerMode: rse.providerMode,
    producerEventAt: rse.producerEventAt,
    receivedAt: rse.receivedAt,
    payloadHash: rse.payloadHash,
    locationScope: rse.locationScope,
    itemScope: rse.itemScope,
    snapshotVersion: rse.snapshotVersion,
  };
}

const rseRefs = (view: RseHealthInputView, rse: RseResultView): string[] => [
  `rse-results-return:${rse.resultsReturnEventId}`,
  ...(rse.sourceRunId ? [`rse-run:${rse.sourceRunId}`] : []),
  `data-hub:${view.contractId}@${view.contractVersion}`,
];

export function mapRseHealthInputs(view: RseHealthInputView, rules: RseInputRules = RSE_INPUT_RULES): MappedRseHealth {
  const notes: string[] = [...view.quality.notes];
  if (view.rseResult.status !== "AVAILABLE") {
    const reason = `No governed RSE result is available: ${view.rseResult.reason}`;
    return { position: none(reason), efficiency: none(reason), slowNonmoving: none(reason), notes };
  }
  const rse = view.rseResult;
  const asOf = new Date(rse.producerEventAt);
  const ctx = sourceContext(view, rse);
  const classes = rse.classificationByClass;
  const cat = rse.catalog;
  const byClass = classes.map((c) => ({ classCode: c.classCode, skuCount: c.skuCount, inventoryValue: c.inventoryValue, underDollars: c.underDollars, overDollars: c.overDollars, belowMinCount: c.belowMinCount, aboveMaxCount: c.aboveMaxCount }));

  // ---- Position & Balance: RSE-authoritative Min/Max results, consumed as returned -----------------------------------------
  let position: MappedEvidence<PositionBalanceEvidence>;
  if (!fin(cat.inventoryValue) || cat.inventoryValue <= 0) position = none("The RSE result carries no positive catalog inventory value to measure Min/Max exposure against.");
  else if (!fin(cat.underDollars) || !fin(cat.overDollars)) position = none("The RSE result does not carry both the below-Min (underDollars) and above-Max (overDollars) exposure.");
  else {
    position = {
      payload: {
        totalInventoryBookValue: cat.inventoryValue,
        belowMinExposureValue: cat.underDollars,
        aboveMaxExcessValue: cat.overDollars,
        ...(fin(cat.skuCount) ? { skusEvaluated: cat.skuCount } : {}),
        ...(fin(cat.belowMinCount) ? { skusBelowMin: cat.belowMinCount } : {}),
        ...(fin(cat.aboveMaxCount) ? { skusAboveMax: cat.aboveMaxCount } : {}),
        context: {
          source: ctx,
          raw: { catalog: cat, dataGapCount: cat.dataGapCount, byClass },
          note: "Below-Min and above-Max exposure are RSE-governed dollar values, so a shortfall is weighted by its value and not counted per item. Classification context is carried per class; IAM does not recompute Min/Max or classes.",
          provisionalCurve: true,
        },
      },
      sourceRefs: rseRefs(view, rse),
      asOf,
      unavailableReason: null,
    };
  }

  // ---- Efficiency: RSE implied turns (actual company measure; no industry benchmark) ------------------------------------------
  let efficiency: MappedEvidence<EfficiencyEvidence>;
  if (!fin(cat.impliedTurns) || cat.impliedTurns < 0) efficiency = none("The RSE result carries no implied inventory turns (no sales basis), so efficiency is not measured.");
  else {
    const annualSales = classes.reduce((a, c) => a + (c.salesDollars ?? 0), 0);
    const annualGp = classes.reduce((a, c) => a + (c.grossProfitDollars ?? 0), 0);
    // GMROI is intentionally NOT derived here (4DR-C3): it needs a governed GMROI target AND a reliable governed gross-profit and
    // inventory input. The RSE annual figures are carried as raw context only; Efficiency reports GMROI as Not Available / Not Configured.
    efficiency = {
      payload: {
        inventoryTurns: cat.impliedTurns,
        context: {
          source: ctx,
          raw: { impliedTurns: cat.impliedTurns, annualSalesDollars: r2(annualSales), annualGrossProfitDollars: r2(annualGp), salesDollarLabel: rse.salesDollarLabel, inventoryValue: cat.inventoryValue, turnsByClass: classes.map((c) => ({ classCode: c.classCode, impliedTurns: c.impliedTurns, inventoryValue: c.inventoryValue, salesDollars: c.salesDollars })) },
          gmroiStatus: "NOT_AVAILABLE_NOT_CONFIGURED_OR_NO_GOVERNED_INPUT",
          provisionalCurve: true,
        },
      },
      sourceRefs: rseRefs(view, rse),
      asOf,
      unavailableReason: null,
    };
  }

  // ---- Slow / Nonmoving: RSE class F (governed) + provisional age window over raw Data Hub aging bands ------------------------
  let slowNonmoving: MappedEvidence<SlowNonmovingEvidence>;
  if (view.aging.status !== "AVAILABLE") {
    slowNonmoving = none(`Slow-moving exposure needs governed last-sale aging evidence, which is not available: ${view.aging.reason} Nonmoving (RSE class F) alone is not scored as if the slow portion were zero.`);
  } else if (!fin(cat.inventoryValue) || cat.inventoryValue <= 0) {
    slowNonmoving = none("The RSE result carries no positive catalog inventory value to measure slow / nonmoving exposure against.");
  } else if (!classes.length) {
    slowNonmoving = none("The RSE result carries no per-class classification, so the governed nonmoving class cannot be read.");
  } else {
    const aging = view.aging;
    const f = classes.find((c) => c.classCode === rules.nonMovingClassCode);
    const nonMoving = f && fin(f.inventoryValue) ? f.inventoryValue : 0;
    const fOver = f && fin(f.overDollars) ? Math.min(f.overDollars, nonMoving) : 0;
    const slowBands = aging.bands.filter((b) => rules.slowBands.includes(b.band));
    const slow = r2(slowBands.reduce((a, b) => a + b.inventoryValue, 0));
    const govProtected = r2(slowBands.reduce((a, b) => a + b.sellThrough.governedRse.protectedValue, 0));
    const fbProtected = r2(slowBands.reduce((a, b) => a + b.sellThrough.recentSalesFallback.protectedValue, 0));
    const govValue = r2(slowBands.reduce((a, b) => a + b.sellThrough.governedRse.valueWithEvidence, 0));
    const fbValue = r2(slowBands.reduce((a, b) => a + b.sellThrough.recentSalesFallback.valueWithEvidence, 0));
    const protectedValue = r2(govProtected + fbProtected);
    const withoutEvidence = r2(slowBands.reduce((a, b) => a + b.sellThrough.valueWithoutDemandEvidence, 0));
    const st = view.sellThrough;
    const salesEnd = st.status === "AVAILABLE" ? st.salesPeriodEndMax : null;
    const nstSource: NaturalSellThroughSource | null = govValue > 0 && fbValue > 0 ? "MIXED_GOVERNED_AND_FALLBACK" : govValue > 0 ? "GOVERNED_RSE_DEMAND" : fbValue > 0 ? "FALLBACK_RECENT_COST_OF_SALES" : null;
    const stRef = `data-hub:${view.contractId}@${view.contractVersion}:sell-through:source=${nstSource ?? "none"}:rse-run=${view.rseDemand.status === "AVAILABLE" ? view.rseDemand.sourceRunId : "n/a"}:positions=${aging.positionsAsOf}:sales-through=${salesEnd ?? "n/a"}:horizon=${st.horizonDays}`;
    const naturalSellThrough =
      st.status === "AVAILABLE" && st.horizonDays <= rules.naturalSellThroughHorizonDays && slow > 0 && nstSource
        ? {
            protectedValue,
            horizonDays: st.horizonDays,
            evidenceRef: stRef,
            source: nstSource,
            confidence: (fbValue > 0 ? "REDUCED" : "GOVERNED") as "GOVERNED" | "REDUCED",
            governedRseProtectedValue: govProtected,
            fallbackProtectedValue: fbProtected,
          }
        : null;
    if (slow + nonMoving > cat.inventoryValue * 1.0000001) {
      slowNonmoving = none(`The slow (${slow}) plus nonmoving (${nonMoving}) values exceed the RSE catalog inventory value (${cat.inventoryValue}); the two governed sources disagree, so the component is marked Requires Verification instead of scored.`);
    } else {
      // Freshness clock = the age of the business evidence (4DR-C6): the OLDEST contributing source time, never the Data Hub read time.
      const times = [asOf.getTime(), Date.parse(aging.positionsAsOf)];
      if (fbValue > 0 && salesEnd) times.push(Date.parse(salesEnd));
      const oldest = Math.min(...times.filter((t) => !Number.isNaN(t)));
      const sourceTimes = { rseSnapshotProducerEventAt: rse.producerEventAt, inventoryPositionAsOf: aging.positionsAsOf, salesPeriodEnd: salesEnd };
      slowNonmoving = {
        payload: {
          totalInventoryBookValue: cat.inventoryValue,
          slowMovingValue: slow,
          nonMovingValue: nonMoving,
          // No overlapWithAboveMaxValue: the three dimensions are kept separate and the overlap is disclosed, never deducted (4DR-C1).
          naturalSellThrough,
          context: {
            source: ctx,
            provisionalRule: { id: rules.ruleId, hash: RSE_INPUT_RULES_HASH, provisional: true, slow: rules.slowWindowText, slowBands: [...rules.slowBands], nonMoving: `RSE class ${rules.nonMovingClassCode} (zero sales), RSE-governed (authoritative nonmoving classification)` },
            raw: {
              nonMovingClassValue: nonMoving,
              nonMovingClassOverMax: fOver,
              slowBandValues: slowBands.map((b) => ({ band: b.band, skuCount: b.skuCount, inventoryValue: b.inventoryValue, protectedValue: b.sellThrough.protectedValue })),
              agingBands: aging.bands.map((b) => ({ band: b.band, skuCount: b.skuCount, inventoryValue: b.inventoryValue })),
              positionsAsOf: aging.positionsAsOf,
              positionsTotalValue: aging.totalInventoryValue,
              rseCatalogInventoryValue: cat.inventoryValue,
              positionsToRseValueRatio: cat.inventoryValue > 0 ? r2(aging.totalInventoryValue / cat.inventoryValue) : null,
              positionsWithoutCost: aging.positionsWithoutCost,
              sourceImportBatchIds: aging.sourceImportBatchIds,
              aboveMaxExposure: cat.overDollars,
            },
            naturalSellThrough: {
              horizonDays: st.horizonDays,
              status: naturalSellThrough ? "EVIDENCED" : slow > 0 ? "REQUIRES_VERIFICATION" : "NOT_NEEDED",
              source: nstSource ?? "NONE",
              confidence: naturalSellThrough ? naturalSellThrough.confidence : null,
              governedDemandSource: view.rseDemand.status === "AVAILABLE" ? { fields: view.rseDemand.sourceFields, derivation: view.rseDemand.derivation, sourceRunId: view.rseDemand.sourceRunId, itemsWithGovernedDemand: view.rseDemand.itemsWithGovernedDemand } : { status: "NOT_AVAILABLE", reason: view.rseDemand.reason },
              slowValueWithGovernedDemand: govValue,
              slowValueWithFallbackDemand: fbValue,
              slowValueWithoutDemandEvidence: withoutEvidence,
              reason: naturalSellThrough
                ? nstSource === "GOVERNED_RSE_DEMAND"
                  ? "Protection limited to governed RSE demand; items without demand evidence are not protected."
                  : "Protection uses governed RSE demand where it exists and LOWER-CONFIDENCE recent cost of sales (labelled fallback, not equivalent) elsewhere; items without any demand evidence are not protected."
                : slow > 0
                  ? "Requires Verification: no credible demand evidence for the slow inventory, so no natural sell-through protection is assumed."
                  : "No slow-band exposure to protect.",
            },
            overlapDisclosure: {
              treatment: "DISCLOSED_NOT_DEDUCTED",
              statement: "Slow / Nonmoving, RSE class F and Position & Balance above-Max exposure are separate dimensions. They can overlap (class F with the age-band slow window near day 180; class F over-Max and above-Max; slow inventory and above-Max). The overlap cannot be deduplicated from the governed aggregates, so none is removed, and the values must not be added into one 'total problem dollars' figure.",
              possibleOverlaps: ["CLASS_F_WITH_SLOW_AGE_BAND_NEAR_DAY_180", "CLASS_F_OVER_MAX_WITH_ABOVE_MAX", "SLOW_AGE_BAND_WITH_ABOVE_MAX"],
              nonmovingClassOverMax: fOver,
              aboveMaxExposure: cat.overDollars,
            },
            sourceTimes,
            sourceSkew: skewDiagnostics(sourceTimes),
            coherence: view.coherence,
          },
        },
        sourceRefs: [...rseRefs(view, rse), `data-hub:INVENTORY_POSITION:asOf=${aging.positionsAsOf}`, ...aging.sourceImportBatchIds.map((b) => `data-hub-import-batch:${b}`)],
        asOf: new Date(oldest),
        unavailableReason: null,
      };
    }
  }
  return { position, efficiency, slowNonmoving, notes };
}

// ---- ingestion into the existing Health evidence store -------------------------------------------------------------------------

export interface RseIngestComponent {
  kind: HealthEvidenceKind;
  status: "RECORDED" | "UNCHANGED" | "UNAVAILABLE";
  reason: string | null;
  evidenceId: string | null;
  evidenceVersion: number | null;
}
export interface RseIngestResult {
  ok: boolean;
  readAt: string;
  contract: { id: string; version: string; hash: string } | null;
  sourceRunId: string | null;
  components: RseIngestComponent[];
  notes: string[];
  failure: { code: string; message: string } | null;
}

type Ctx = { dposCompanyId: string; companyTimeZone?: string | null };

/**
 * Reads the governed view and records Position & Balance, Efficiency and Slow / Nonmoving evidence into iam_core_health_evidence
 * (the existing canonical 4D store; no parallel system). Unchanged evidence creates no new version, so a refresh that finds the same
 * RSE result does not create noise. A failed read records nothing and the previous evidence stays (it simply ages).
 */
export async function ingestRseHealthInputs(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, provider: RseHealthProvider, opts: { at?: Date; rules?: RseInputRules } = {}): Promise<RseIngestResult> {
  const readAt = opts.at ?? new Date();
  let view: RseHealthInputView;
  try {
    const got = await provider.fetch();
    assertPinnedContract(got);
    view = got;
  } catch (e) {
    const code = e instanceof DataHubClientError ? e.code : "RSE_HEALTH_READ_FAILED";
    const message = e instanceof Error ? e.message : String(e);
    await writeAudit(db, { category: "HEALTH", action: "HEALTH_RSE_INPUT_READ", outcome: "FAILURE", actor: actor.actorId, dposCompanyId: ctx.dposCompanyId, subjectType: "RseHealthInput", subjectId: RSE_HEALTH_CONTRACT_PIN.contractId, detail: { code, message }, at: readAt });
    return { ok: false, readAt: readAt.toISOString(), contract: null, sourceRunId: null, components: [], notes: [], failure: { code, message } };
  }
  const mapped = mapRseHealthInputs(view, opts.rules);
  const components: RseIngestComponent[] = [];
  const doKind = async <T extends object>(kind: HealthEvidenceKind, m: MappedEvidence<T>) => {
    if (!m.payload) {
      components.push({ kind, status: "UNAVAILABLE", reason: m.unavailableReason, evidenceId: null, evidenceVersion: null });
      return;
    }
    const r = await recordHealthEvidence(db, ctx, actor, kind, m.payload, { sourceRefs: m.sourceRefs, asOf: m.asOf ?? undefined, at: readAt });
    components.push({ kind, status: r.unchanged ? "UNCHANGED" : "RECORDED", reason: null, evidenceId: r.evidenceId, evidenceVersion: r.evidenceVersion });
  };
  await doKind("POSITION_BALANCE", mapped.position);
  await doKind("EFFICIENCY", mapped.efficiency);
  await doKind("SLOW_NONMOVING", mapped.slowNonmoving);
  const sourceRunId = view.rseResult.status === "AVAILABLE" ? view.rseResult.sourceRunId : null;
  await writeAudit(db, {
    category: "HEALTH",
    action: "HEALTH_RSE_INPUT_READ",
    outcome: "SUCCESS",
    actor: actor.actorId,
    dposCompanyId: ctx.dposCompanyId,
    subjectType: "RseHealthInput",
    subjectId: RSE_HEALTH_CONTRACT_PIN.contractId,
    detail: { contractVersion: view.contractVersion, dataHubReadAt: view.generatedAt, sourceRunId, components: components.map((c) => ({ kind: c.kind, status: c.status, evidenceVersion: c.evidenceVersion })), notes: mapped.notes },
    at: readAt,
  });
  return { ok: true, readAt: readAt.toISOString(), contract: { id: view.contractId, version: view.contractVersion, hash: view.contractHash }, sourceRunId, components, notes: mapped.notes, failure: null };
}

/** The Data Hub provider (the existing governed client). */
export function createDataHubRseHealthProvider(client: { readRseHealthInputs(horizonDays?: number): Promise<RseHealthInputView> }, horizonDays: number = RSE_INPUT_RULES.naturalSellThroughHorizonDays): RseHealthProvider {
  return { fetch: () => client.readRseHealthInputs(horizonDays) };
}

/** The most recent governed read of the RSE health inputs (Data Hub read time), for the component pages. */
export async function lastRseInputRead(db: PrismaClient, dposCompanyId: string): Promise<{ at: string; outcome: string; detail: Record<string, unknown> | null } | null> {
  const row = await db.dposAuditEvent.findFirst({ where: { dposCompanyId, action: "HEALTH_RSE_INPUT_READ" }, orderBy: { at: "desc" } });
  if (!row) return null;
  let detail: Record<string, unknown> | null = null;
  try {
    detail = row.detailJson ? (JSON.parse(row.detailJson) as Record<string, unknown>) : null;
  } catch {
    detail = null;
  }
  return { at: row.at.toISOString(), outcome: row.outcome, detail };
}
