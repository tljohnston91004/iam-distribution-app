/**
 * Stage 4D governed health evidence: the authoritative values IAM CONSUMES to calculate components A-C (and the company facts
 * used by B and D). RSE remains authoritative: IAM never recreates Min/Max or classification logic, it only reads the governed
 * results supplied here, with their source references. Validation refuses anything that is not a finite, sensible number so an
 * unmeasured value can never silently become a zero.
 */
export const HEALTH_EVIDENCE_KINDS = ["POSITION_BALANCE", "EFFICIENCY", "SLOW_NONMOVING", "COMPANY_FACTS"] as const;
export type HealthEvidenceKind = (typeof HEALTH_EVIDENCE_KINDS)[number];

/**
 * Stage 4D-R: optional, additive provenance and raw-metric context carried WITH the evidence (source run, contract, read-time
 * references, raw inputs, rule ids, PROVISIONAL flags). It is stored and hashed with the evidence so the calculation is
 * reproducible, but it never changes a component calculation: calculators read only the typed fields below.
 */
export type EvidenceContext = Record<string, unknown>;

/** Component A: governed Min/Max position results (RSE-authoritative). */
export interface PositionBalanceEvidence {
  context?: EvidenceContext;
  /** Total inventory book value the exposures below are measured against. */
  totalInventoryBookValue: number;
  /** Value of the shortfall of below-Min positions to reach Min. */
  belowMinExposureValue: number;
  /** Value of positions above Max in excess of Max. */
  aboveMaxExcessValue: number;
  skusEvaluated?: number;
  skusBelowMin?: number;
  skusAboveMax?: number;
}

/** Component B: governed efficiency results (RSE-authoritative). Targets live in COMPANY_FACTS, never here. */
export interface EfficiencyEvidence {
  context?: EvidenceContext;
  inventoryTurns: number;
  gmroi?: number;
}

/** Component C: governed slow-moving / nonmoving exposure (RSE classification, authoritative). */
export interface SlowNonmovingEvidence {
  context?: EvidenceContext;
  totalInventoryBookValue: number;
  slowMovingValue: number;
  nonMovingValue: number;
  /** The part of the slow / nonmoving value that is ALSO already counted as above-Max excess (no double counting). */
  overlapWithAboveMaxValue?: number;
  /**
   * Natural sell-through evidence. Present ONLY when the governed demand history supports it. Sell-through is never inferred:
   * without this block no protection is applied.
   */
  naturalSellThrough?: {
    /** Value expected to sell through naturally within `horizonDays` at the evidenced demand rate. */
    protectedValue: number;
    horizonDays: number;
    evidenceRef: string;
    /** Where the protection came from. Governed RSE demand is PRIMARY; recent cost-of-sales is a labelled lower-confidence fallback. */
    source?: NaturalSellThroughSource;
    /** GOVERNED when all protection is governed RSE demand; REDUCED when any of it is fallback evidence. */
    confidence?: "GOVERNED" | "REDUCED";
    governedRseProtectedValue?: number;
    fallbackProtectedValue?: number;
  } | null;
}

export type NaturalSellThroughSource = "GOVERNED_RSE_DEMAND" | "MIXED_GOVERNED_AND_FALLBACK" | "FALLBACK_RECENT_COST_OF_SALES";
const NST_SOURCES: readonly string[] = ["GOVERNED_RSE_DEMAND", "MIXED_GOVERNED_AND_FALLBACK", "FALLBACK_RECENT_COST_OF_SALES"];

/** Company facts the Product Owner / company has governed (targets and the revenue basis). */
export interface CompanyFactsEvidence {
  /** Company inventory turns target (component B). */
  turnsTarget?: number;
  /** Company GMROI target (component B, optional second measure). */
  gmroiTarget?: number;
  /** Revenue basis for the shortage severity (component D): average weekly revenue ... */
  averageWeeklyRevenue?: number;
  /** ... or annual revenue (divided by 52). */
  annualRevenue?: number;
  currency?: string;
  /** Free-text marker (for example that every target was cleared). Never a business value. */
  note?: string;
}

export type EvidencePayload = PositionBalanceEvidence | EfficiencyEvidence | SlowNonmovingEvidence | CompanyFactsEvidence;

export interface EvidenceValidation<T> {
  ok: boolean;
  value?: T;
  issues: string[];
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function nonNegative(obj: Record<string, unknown>, field: string, issues: string[], required: boolean): number | undefined {
  const v = obj[field];
  if (v === undefined || v === null) {
    if (required) issues.push(`${field} is required.`);
    return undefined;
  }
  if (!isNum(v) || v < 0) {
    issues.push(`${field} must be a finite number that is not negative.`);
    return undefined;
  }
  return v;
}

function positive(obj: Record<string, unknown>, field: string, issues: string[]): number | undefined {
  const v = obj[field];
  if (v === undefined || v === null) return undefined;
  if (!isNum(v) || v <= 0) {
    issues.push(`${field} must be a finite number greater than zero.`);
    return undefined;
  }
  return v;
}

function optionalCount(obj: Record<string, unknown>, field: string, issues: string[]): number | undefined {
  const v = obj[field];
  if (v === undefined || v === null) return undefined;
  if (!isNum(v) || v < 0 || !Number.isInteger(v)) {
    issues.push(`${field} must be a whole number that is not negative.`);
    return undefined;
  }
  return v;
}

const MAX_CONTEXT_BYTES = 16 * 1024;

/** A context must be a plain JSON object of bounded size (no functions, no cycles, no non-finite numbers). */
function sanitizeContext(raw: unknown): { ok: boolean; value?: EvidenceContext; issue?: string } {
  if (raw === undefined || raw === null) return { ok: true };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, issue: "context must be an object or omitted." };
  let json: string;
  try {
    json = JSON.stringify(raw, (_k, v) => {
      if (typeof v === "number" && !Number.isFinite(v)) throw new Error("non-finite");
      if (typeof v === "function" || typeof v === "bigint" || typeof v === "symbol") throw new Error("not json");
      return v;
    });
  } catch {
    return { ok: false, issue: "context must be plain JSON with finite numbers." };
  }
  if (json.length > MAX_CONTEXT_BYTES) return { ok: false, issue: `context is larger than ${MAX_CONTEXT_BYTES} bytes.` };
  return { ok: true, value: JSON.parse(json) as EvidenceContext };
}

export function validateEvidence(kind: HealthEvidenceKind, raw: unknown): EvidenceValidation<EvidencePayload> {
  const core = validateEvidenceCore(kind, raw);
  if (!core.ok || !core.value) return core;
  if (kind === "COMPANY_FACTS") return core;
  const c = sanitizeContext((raw as Record<string, unknown>).context);
  if (!c.ok) return { ok: false, issues: [c.issue!] };
  if (c.value) (core.value as { context?: EvidenceContext }).context = c.value;
  return core;
}

function validateEvidenceCore(kind: HealthEvidenceKind, raw: unknown): EvidenceValidation<EvidencePayload> {
  const issues: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, issues: ["The evidence must be an object."] };
  const o = raw as Record<string, unknown>;
  switch (kind) {
    case "POSITION_BALANCE": {
      const total = positive(o, "totalInventoryBookValue", issues);
      if (total === undefined && !issues.length) issues.push("totalInventoryBookValue is required and must be greater than zero.");
      const below = nonNegative(o, "belowMinExposureValue", issues, true);
      const above = nonNegative(o, "aboveMaxExcessValue", issues, true);
      const skusEvaluated = optionalCount(o, "skusEvaluated", issues);
      const skusBelowMin = optionalCount(o, "skusBelowMin", issues);
      const skusAboveMax = optionalCount(o, "skusAboveMax", issues);
      if (issues.length) return { ok: false, issues };
      const value: PositionBalanceEvidence = { totalInventoryBookValue: total!, belowMinExposureValue: below!, aboveMaxExcessValue: above! };
      if (skusEvaluated !== undefined) value.skusEvaluated = skusEvaluated;
      if (skusBelowMin !== undefined) value.skusBelowMin = skusBelowMin;
      if (skusAboveMax !== undefined) value.skusAboveMax = skusAboveMax;
      return { ok: true, value, issues: [] };
    }
    case "EFFICIENCY": {
      const turns = nonNegative(o, "inventoryTurns", issues, true);
      const gmroi = nonNegative(o, "gmroi", issues, false);
      if (issues.length) return { ok: false, issues };
      const value: EfficiencyEvidence = { inventoryTurns: turns! };
      if (gmroi !== undefined) value.gmroi = gmroi;
      return { ok: true, value, issues: [] };
    }
    case "SLOW_NONMOVING": {
      const total = positive(o, "totalInventoryBookValue", issues);
      if (total === undefined && !issues.length) issues.push("totalInventoryBookValue is required and must be greater than zero.");
      const slow = nonNegative(o, "slowMovingValue", issues, true);
      const non = nonNegative(o, "nonMovingValue", issues, true);
      const overlap = nonNegative(o, "overlapWithAboveMaxValue", issues, false);
      let nst: SlowNonmovingEvidence["naturalSellThrough"] = null;
      const rawNst = o.naturalSellThrough;
      if (rawNst !== undefined && rawNst !== null) {
        if (typeof rawNst !== "object" || Array.isArray(rawNst)) issues.push("naturalSellThrough must be an object or omitted.");
        else {
          const n = rawNst as Record<string, unknown>;
          const protectedValue = nonNegative(n, "protectedValue", issues, true);
          const horizon = n.horizonDays;
          if (!isNum(horizon) || horizon <= 0 || !Number.isInteger(horizon)) issues.push("naturalSellThrough.horizonDays must be a positive whole number of days.");
          const ref = typeof n.evidenceRef === "string" ? n.evidenceRef.trim() : "";
          if (!ref) issues.push("naturalSellThrough.evidenceRef is required: sell-through is never inferred without evidence.");
          const srcRaw = n.source;
          if (srcRaw !== undefined && (typeof srcRaw !== "string" || !NST_SOURCES.includes(srcRaw))) issues.push("naturalSellThrough.source must be GOVERNED_RSE_DEMAND, MIXED_GOVERNED_AND_FALLBACK or FALLBACK_RECENT_COST_OF_SALES.");
          if (n.confidence !== undefined && n.confidence !== "GOVERNED" && n.confidence !== "REDUCED") issues.push("naturalSellThrough.confidence must be GOVERNED or REDUCED.");
          const gov = nonNegative(n, "governedRseProtectedValue", issues, false);
          const fb = nonNegative(n, "fallbackProtectedValue", issues, false);
          if (!issues.length) {
            nst = { protectedValue: protectedValue!, horizonDays: horizon as number, evidenceRef: ref };
            if (srcRaw !== undefined) nst.source = srcRaw as NaturalSellThroughSource;
            if (n.confidence !== undefined) nst.confidence = n.confidence as "GOVERNED" | "REDUCED";
            if (gov !== undefined) nst.governedRseProtectedValue = gov;
            if (fb !== undefined) nst.fallbackProtectedValue = fb;
          }
        }
      }
      if (issues.length) return { ok: false, issues };
      if (slow! + non! > total! * 1.0000001) return { ok: false, issues: ["slowMovingValue + nonMovingValue cannot exceed totalInventoryBookValue."] };
      const value: SlowNonmovingEvidence = { totalInventoryBookValue: total!, slowMovingValue: slow!, nonMovingValue: non!, naturalSellThrough: nst };
      if (overlap !== undefined) value.overlapWithAboveMaxValue = overlap;
      return { ok: true, value, issues: [] };
    }
    case "COMPANY_FACTS": {
      const turnsTarget = positive(o, "turnsTarget", issues);
      const gmroiTarget = positive(o, "gmroiTarget", issues);
      const weekly = positive(o, "averageWeeklyRevenue", issues);
      const annual = positive(o, "annualRevenue", issues);
      const currency = typeof o.currency === "string" && o.currency.trim() ? o.currency.trim() : undefined;
      if (issues.length) return { ok: false, issues };
      const value: CompanyFactsEvidence = {};
      if (turnsTarget !== undefined) value.turnsTarget = turnsTarget;
      if (gmroiTarget !== undefined) value.gmroiTarget = gmroiTarget;
      if (weekly !== undefined) value.averageWeeklyRevenue = weekly;
      if (annual !== undefined) value.annualRevenue = annual;
      if (currency) value.currency = currency;
      const note = typeof o.note === "string" && o.note.trim() ? o.note.trim().slice(0, 200) : undefined;
      if (note) value.note = note;
      if (!Object.keys(value).length) return { ok: false, issues: ["COMPANY_FACTS must supply at least one governed fact."] };
      return { ok: true, value, issues: [] };
    }
    default:
      return { ok: false, issues: [`Unknown evidence kind ${String(kind)}.`] };
  }
}
