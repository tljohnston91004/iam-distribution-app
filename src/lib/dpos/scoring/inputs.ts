/**
 * Stage 4C: the stored scoring facts for one candidate and their strict validation.
 *
 * "No hidden factors": the engine scores ONLY these fields. Unknown keys are rejected, so nothing can influence a score
 * without being a named, validated, persisted input. The strategic modifier is deliberately NOT an input: it comes only from
 * a management authorization recorded in the governance ledger.
 */
import {
  ACTIONABILITY_LEVELS,
  BENEFIT_UNCERTAINTY_LEVELS,
  CONFIDENCE_LEVELS,
  CONTEXT_INFLUENCES,
  HOMES_BY_IMPACT,
  IMPACT_TYPES,
  SCORING_HOMES,
  SUMMED_HOME_BY_IMPACT,
  CROSS_FUNCTIONAL_LEVELS,
  DETERIORATION_LEVELS,
  EMERGENCY_THREAT_CATEGORIES,
  EXECUTION_BURDEN_LEVELS,
  PERSISTENCE_EXCLUSIONS,
  SEVERITY_LEVELS,
  type ActionabilityLevel,
  type BenefitUncertaintyLevel,
  type ConfidenceLevel,
  type ContextInfluence,
  type CrossFunctionalLevel,
  type DeteriorationLevel,
  type EmergencyThreatCategory,
  type ExecutionBurdenLevel,
  type ImpactType,
  type PersistenceExclusion,
  type ScoringHome,
  type SeverityLevel,
} from "./config";

/**
 * 4C-D2: one quantified economic amount used in scoring. `evidenceRef` + `impactType` is its economic identity; `scoringHome` is the ONE
 * place it earns points. The same economic identity may never be used twice (in this candidate or another open candidate).
 */
export interface EconomicAttribution {
  evidenceRef: string;
  impactType: ImpactType;
  scoringHome: ScoringHome;
  amount: number;
  /** The candidate this amount is attributed to, when the producer says so (it must be this candidate). */
  candidateRef?: string;
}

/** Evidence that may inform severity, context, root cause or qualitative risk. It earns no quantified points, so it can overlap freely. */
export interface ContextualEvidence {
  evidenceRef: string;
  influences: ContextInfluence[];
}

export const economicKey = (a: Pick<EconomicAttribution, "evidenceRef" | "impactType">): string => `${a.evidenceRef}|${a.impactType}`;

export interface ScoringInputs {
  cash: {
    /** Expected 13-week NET scoreable cash impact (a cash effect already counted by another candidate must not be repeated here). */
    expected13WeekNetCashImpact: number;
    /** Average weekly revenue. When omitted, trailing52WeekRevenue / 52 is used. */
    averageWeeklyRevenue?: number;
    trailing52WeekRevenue?: number;
  };
  profitability: {
    /** Net scoreable profitability improvement/protection on a trailing-12-month-comparable basis. */
    netProfitabilityImpact: number;
    trailing12MonthGrossProfit: number;
    /** A short-period effect is never annualized by the engine; a producer that annualized must say how. */
    effectPeriodDays?: number;
    annualizationBasis?: string;
  };
  inventoryExposure: { affectedInventoryBookValue: number; totalInventoryBookValue: number };
  /** 4C-D2: every quantified amount above is the sum of its attributions (one scoring home each). */
  economicAttribution: EconomicAttribution[];
  contextualEvidence?: ContextualEvidence[];
  operationalRisk: SeverityLevel;
  customerRevenue: SeverityLevel;
  timeSensitivity: { daysToAction: number; overdue?: boolean };
  actionability: ActionabilityLevel;
  dataConfidence: ConfidenceLevel;
  modifiers?: {
    deterioration?: { level: DeteriorationLevel; comparativeEvidenceRef?: string };
    crossFunctional?: CrossFunctionalLevel;
    executionBurden?: ExecutionBurdenLevel;
    benefitUncertainty?: BenefitUncertaintyLevel;
    /** Ordinary seasonal or already-controlled conditions do not earn a persistence modifier. */
    persistenceExclusion?: PersistenceExclusion;
  };
  emergency?: {
    irreversibleMaterialPreventableLoss?: boolean;
    /** Days available to act; defaults to timeSensitivity.daysToAction. */
    actionWindowDays?: number;
    verifiedThreat?: { category: EmergencyThreatCategory; verifiedBy: string; verifiedAt: string; evidenceRef: string };
  };
  /** Preventable loss (tie-break 6). */
  preventableLoss?: number;
  /** Action deadline (tie-break 11), a YYYY-MM-DD date. */
  actionDeadline?: string;
  sourceRefs?: string[];
}

export interface ValidationResult {
  ok: boolean;
  issues: string[];
  value?: ScoringInputs;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function onlyKeys(o: Record<string, unknown>, allowed: readonly string[], path: string, issues: string[]) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) issues.push(`${path}${k}: unknown field (the scoring model has no hidden factors)`);
}

function oneOf<T extends string>(v: unknown, set: readonly T[], path: string, issues: string[], optional = false): T | undefined {
  if (v === undefined && optional) return undefined;
  if (typeof v === "string" && (set as readonly string[]).includes(v)) return v as T;
  issues.push(`${path}: must be one of ${set.join(", ")}`);
  return undefined;
}

function num(v: unknown, path: string, issues: string[], opts: { min?: number; optional?: boolean; integer?: boolean } = {}): number | undefined {
  if (v === undefined && opts.optional) return undefined;
  if (!isNum(v)) {
    issues.push(`${path}: must be a finite number`);
    return undefined;
  }
  if (opts.min !== undefined && v < opts.min) issues.push(`${path}: must be >= ${opts.min}`);
  if (opts.integer && !Number.isInteger(v)) issues.push(`${path}: must be a whole number`);
  return v;
}

function strList(v: unknown, path: string, issues: string[]): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x.trim())) {
    issues.push(`${path}: must be a list of non-empty strings`);
    return undefined;
  }
  return v.map((x: string) => x.trim());
}

export function validateScoringInputs(raw: unknown): ValidationResult {
  const issues: string[] = [];
  if (!isObj(raw)) return { ok: false, issues: ["inputs: must be an object"] };
  onlyKeys(raw, ["cash", "profitability", "inventoryExposure", "operationalRisk", "customerRevenue", "timeSensitivity", "actionability", "dataConfidence", "modifiers", "emergency", "preventableLoss", "actionDeadline", "sourceRefs", "economicAttribution", "contextualEvidence"], "", issues);

  // cash
  const cash = raw.cash;
  let cashOut: ScoringInputs["cash"] | undefined;
  if (!isObj(cash)) issues.push("cash: required");
  else {
    onlyKeys(cash, ["expected13WeekNetCashImpact", "averageWeeklyRevenue", "trailing52WeekRevenue"], "cash.", issues);
    const impact = num(cash.expected13WeekNetCashImpact, "cash.expected13WeekNetCashImpact", issues);
    const weekly = num(cash.averageWeeklyRevenue, "cash.averageWeeklyRevenue", issues, { optional: true });
    const t52 = num(cash.trailing52WeekRevenue, "cash.trailing52WeekRevenue", issues, { optional: true });
    if (weekly === undefined && t52 === undefined) issues.push("cash: averageWeeklyRevenue or trailing52WeekRevenue is required");
    if ((weekly !== undefined && weekly <= 0) || (weekly === undefined && t52 !== undefined && t52 <= 0)) issues.push("cash: the revenue denominator must be greater than zero");
    if (impact !== undefined) cashOut = { expected13WeekNetCashImpact: impact, ...(weekly !== undefined ? { averageWeeklyRevenue: weekly } : {}), ...(t52 !== undefined ? { trailing52WeekRevenue: t52 } : {}) };
  }

  // profitability
  const prof = raw.profitability;
  let profOut: ScoringInputs["profitability"] | undefined;
  if (!isObj(prof)) issues.push("profitability: required");
  else {
    onlyKeys(prof, ["netProfitabilityImpact", "trailing12MonthGrossProfit", "effectPeriodDays", "annualizationBasis"], "profitability.", issues);
    const impact = num(prof.netProfitabilityImpact, "profitability.netProfitabilityImpact", issues);
    const gp = num(prof.trailing12MonthGrossProfit, "profitability.trailing12MonthGrossProfit", issues);
    if (gp !== undefined && gp <= 0) issues.push("profitability.trailing12MonthGrossProfit: must be greater than zero");
    const days = num(prof.effectPeriodDays, "profitability.effectPeriodDays", issues, { optional: true, min: 1, integer: true });
    const basis = typeof prof.annualizationBasis === "string" ? prof.annualizationBasis.trim() : undefined;
    if (prof.annualizationBasis !== undefined && !basis) issues.push("profitability.annualizationBasis: must not be blank");
    if (days !== undefined && days < 365 && !basis) {
      issues.push("profitability: an effect measured over fewer than 365 days must state how it was put on a 12-month basis (annualizationBasis); the engine never annualizes");
    }
    if (impact !== undefined && gp !== undefined) profOut = { netProfitabilityImpact: impact, trailing12MonthGrossProfit: gp, ...(days !== undefined ? { effectPeriodDays: days } : {}), ...(basis ? { annualizationBasis: basis } : {}) };
  }

  // inventory exposure
  const inv = raw.inventoryExposure;
  let invOut: ScoringInputs["inventoryExposure"] | undefined;
  if (!isObj(inv)) issues.push("inventoryExposure: required");
  else {
    onlyKeys(inv, ["affectedInventoryBookValue", "totalInventoryBookValue"], "inventoryExposure.", issues);
    const a = num(inv.affectedInventoryBookValue, "inventoryExposure.affectedInventoryBookValue", issues, { min: 0 });
    const t = num(inv.totalInventoryBookValue, "inventoryExposure.totalInventoryBookValue", issues);
    if (t !== undefined && t <= 0) issues.push("inventoryExposure.totalInventoryBookValue: must be greater than zero");
    if (a !== undefined && t !== undefined && a > t) issues.push("inventoryExposure: affected inventory cannot exceed total inventory");
    if (a !== undefined && t !== undefined) invOut = { affectedInventoryBookValue: a, totalInventoryBookValue: t };
  }

  // 4C-D2: economic attribution. Every quantified amount has an identity, an impact type, ONE scoring home and an amount.
  const attributions: EconomicAttribution[] = [];
  if (raw.economicAttribution === undefined) {
    // Required only when something quantified is claimed (an all-zero candidate has nothing to attribute).
    const quantified = (cashOut?.expected13WeekNetCashImpact ?? 0) !== 0 || (profOut?.netProfitabilityImpact ?? 0) !== 0 || (invOut?.affectedInventoryBookValue ?? 0) !== 0;
    if (quantified) issues.push("economicAttribution: required - every quantified economic amount needs its evidence identity, impact type and ONE scoring home");
  } else if (!Array.isArray(raw.economicAttribution)) issues.push("economicAttribution: must be a list");
  else {
    const seen = new Set<string>();
    raw.economicAttribution.forEach((e: unknown, i: number) => {
      const p = `economicAttribution[${i}].`;
      if (!isObj(e)) {
        issues.push(`economicAttribution[${i}]: must be an object`);
        return;
      }
      onlyKeys(e, ["evidenceRef", "impactType", "scoringHome", "amount", "candidateRef"], p, issues);
      const evidenceRef = typeof e.evidenceRef === "string" ? e.evidenceRef.trim() : "";
      if (!evidenceRef) issues.push(`${p}evidenceRef: required (the source/evidence identity of the amount)`);
      const impactType = oneOf(e.impactType, IMPACT_TYPES, `${p}impactType`, issues);
      const scoringHome = oneOf(e.scoringHome, SCORING_HOMES, `${p}scoringHome`, issues);
      const amount = num(e.amount, `${p}amount`, issues);
      const candidateRef = typeof e.candidateRef === "string" ? e.candidateRef.trim() : undefined;
      if (e.candidateRef !== undefined && !candidateRef) issues.push(`${p}candidateRef: must not be blank`);
      if (impactType && scoringHome && !HOMES_BY_IMPACT[impactType].includes(scoringHome)) issues.push(`${p}scoringHome: ${impactType} is scored in ${HOMES_BY_IMPACT[impactType].join(" / ")}, not ${scoringHome}`);
      if (evidenceRef && impactType && scoringHome && amount !== undefined) {
        const key = economicKey({ evidenceRef, impactType });
        if (seen.has(key)) issues.push(`${p}evidenceRef: the economic amount ${key} is listed twice - the same economic amount has ONE scoring home and is counted once (use contextualEvidence to reuse the evidence as context)`);
        seen.add(key);
        attributions.push({ evidenceRef, impactType, scoringHome, amount, ...(candidateRef ? { candidateRef } : {}) });
      }
    });
    // The quantified amounts the engine scores ARE the sums of their attributions; nothing is scored without an attribution.
    const sums: Record<"cash" | "profitability" | "inventoryExposure", number> = { cash: 0, profitability: 0, inventoryExposure: 0 };
    for (const a of attributions) {
      const home = SUMMED_HOME_BY_IMPACT[a.impactType];
      if (home) sums[home] += a.amount;
    }
    const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
    if (cashOut && !near(sums.cash, cashOut.expected13WeekNetCashImpact)) issues.push(`economicAttribution: the CASH_IMPACT attributions add up to ${sums.cash}, not the cash amount ${cashOut.expected13WeekNetCashImpact}`);
    if (profOut && !near(sums.profitability, profOut.netProfitabilityImpact)) issues.push(`economicAttribution: the LOST_MARGIN / PROFIT_IMPACT attributions add up to ${sums.profitability}, not the profitability amount ${profOut.netProfitabilityImpact}`);
    if (invOut && !near(sums.inventoryExposure, invOut.affectedInventoryBookValue)) issues.push(`economicAttribution: the INVENTORY_VALUE attributions add up to ${sums.inventoryExposure}, not the affected inventory ${invOut.affectedInventoryBookValue}`);
  }
  const contextual: ContextualEvidence[] = [];
  if (raw.contextualEvidence !== undefined) {
    if (!Array.isArray(raw.contextualEvidence)) issues.push("contextualEvidence: must be a list");
    else {
      raw.contextualEvidence.forEach((c: unknown, i: number) => {
        const p = `contextualEvidence[${i}].`;
        if (!isObj(c)) {
          issues.push(`contextualEvidence[${i}]: must be an object`);
          return;
        }
        onlyKeys(c, ["evidenceRef", "influences"], p, issues);
        const ref = typeof c.evidenceRef === "string" ? c.evidenceRef.trim() : "";
        if (!ref) issues.push(`${p}evidenceRef: required`);
        const inf = Array.isArray(c.influences) ? c.influences : [];
        if (!inf.length || inf.some((x) => !(CONTEXT_INFLUENCES as readonly string[]).includes(x as string))) issues.push(`${p}influences: must be a non-empty list of ${CONTEXT_INFLUENCES.join(", ")}`);
        else if (ref) contextual.push({ evidenceRef: ref, influences: [...new Set(inf as ContextInfluence[])] });
      });
    }
  }

  const operationalRisk = oneOf(raw.operationalRisk, SEVERITY_LEVELS, "operationalRisk", issues);
  const customerRevenue = oneOf(raw.customerRevenue, SEVERITY_LEVELS, "customerRevenue", issues);
  const actionability = oneOf(raw.actionability, ACTIONABILITY_LEVELS, "actionability", issues);
  const dataConfidence = oneOf(raw.dataConfidence, CONFIDENCE_LEVELS, "dataConfidence", issues);

  // time
  const time = raw.timeSensitivity;
  let timeOut: ScoringInputs["timeSensitivity"] | undefined;
  if (!isObj(time)) issues.push("timeSensitivity: required");
  else {
    onlyKeys(time, ["daysToAction", "overdue"], "timeSensitivity.", issues);
    const d = num(time.daysToAction, "timeSensitivity.daysToAction", issues, { integer: true });
    if (time.overdue !== undefined && typeof time.overdue !== "boolean") issues.push("timeSensitivity.overdue: must be true or false");
    if (d !== undefined) timeOut = { daysToAction: d, ...(typeof time.overdue === "boolean" ? { overdue: time.overdue } : {}) };
  }

  // modifiers
  let modOut: ScoringInputs["modifiers"];
  if (raw.modifiers !== undefined) {
    if (!isObj(raw.modifiers)) issues.push("modifiers: must be an object");
    else {
      const m = raw.modifiers;
      onlyKeys(m, ["deterioration", "crossFunctional", "executionBurden", "benefitUncertainty", "persistenceExclusion"], "modifiers.", issues);
      modOut = {};
      if (m.deterioration !== undefined) {
        if (!isObj(m.deterioration)) issues.push("modifiers.deterioration: must be an object");
        else {
          onlyKeys(m.deterioration, ["level", "comparativeEvidenceRef"], "modifiers.deterioration.", issues);
          const level = oneOf(m.deterioration.level, DETERIORATION_LEVELS, "modifiers.deterioration.level", issues);
          const ref = typeof m.deterioration.comparativeEvidenceRef === "string" ? m.deterioration.comparativeEvidenceRef.trim() : undefined;
          if (level) modOut.deterioration = { level, ...(ref ? { comparativeEvidenceRef: ref } : {}) };
        }
      }
      const cf = oneOf(m.crossFunctional, CROSS_FUNCTIONAL_LEVELS, "modifiers.crossFunctional", issues, true);
      if (cf) modOut.crossFunctional = cf;
      const eb = oneOf(m.executionBurden, EXECUTION_BURDEN_LEVELS, "modifiers.executionBurden", issues, true);
      if (eb) modOut.executionBurden = eb;
      const bu = oneOf(m.benefitUncertainty, BENEFIT_UNCERTAINTY_LEVELS, "modifiers.benefitUncertainty", issues, true);
      if (bu) modOut.benefitUncertainty = bu;
      const pe = oneOf(m.persistenceExclusion, PERSISTENCE_EXCLUSIONS, "modifiers.persistenceExclusion", issues, true);
      if (pe) modOut.persistenceExclusion = pe;
    }
  }

  // emergency facts
  let emOut: ScoringInputs["emergency"];
  if (raw.emergency !== undefined) {
    if (!isObj(raw.emergency)) issues.push("emergency: must be an object");
    else {
      const e = raw.emergency;
      onlyKeys(e, ["irreversibleMaterialPreventableLoss", "actionWindowDays", "verifiedThreat"], "emergency.", issues);
      emOut = {};
      if (e.irreversibleMaterialPreventableLoss !== undefined) {
        if (typeof e.irreversibleMaterialPreventableLoss !== "boolean") issues.push("emergency.irreversibleMaterialPreventableLoss: must be true or false");
        else emOut.irreversibleMaterialPreventableLoss = e.irreversibleMaterialPreventableLoss;
      }
      const w = num(e.actionWindowDays, "emergency.actionWindowDays", issues, { optional: true, integer: true });
      if (w !== undefined) emOut.actionWindowDays = w;
      if (e.verifiedThreat !== undefined) {
        const v = e.verifiedThreat;
        if (!isObj(v)) issues.push("emergency.verifiedThreat: must be an object");
        else {
          onlyKeys(v, ["category", "verifiedBy", "verifiedAt", "evidenceRef"], "emergency.verifiedThreat.", issues);
          const category = oneOf(v.category, EMERGENCY_THREAT_CATEGORIES, "emergency.verifiedThreat.category", issues);
          for (const k of ["verifiedBy", "verifiedAt", "evidenceRef"] as const) {
            if (typeof v[k] !== "string" || !(v[k] as string).trim()) issues.push(`emergency.verifiedThreat.${k}: required (a threat must be VERIFIED, with who verified it and the evidence)`);
          }
          if (typeof v.verifiedAt === "string" && Number.isNaN(Date.parse(v.verifiedAt))) issues.push("emergency.verifiedThreat.verifiedAt: must be a date/time");
          if (category && typeof v.verifiedBy === "string" && typeof v.verifiedAt === "string" && typeof v.evidenceRef === "string") {
            emOut.verifiedThreat = { category, verifiedBy: v.verifiedBy.trim(), verifiedAt: v.verifiedAt, evidenceRef: v.evidenceRef.trim() };
          }
        }
      }
    }
  }

  const preventableLoss = num(raw.preventableLoss, "preventableLoss", issues, { optional: true, min: 0 });
  let actionDeadline: string | undefined;
  if (raw.actionDeadline !== undefined) {
    if (typeof raw.actionDeadline !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.actionDeadline) || Number.isNaN(Date.parse(raw.actionDeadline))) issues.push("actionDeadline: must be a YYYY-MM-DD date");
    else actionDeadline = raw.actionDeadline;
  }
  const sourceRefs = strList(raw.sourceRefs, "sourceRefs", issues);

  if (issues.length || !cashOut || !profOut || !invOut || !operationalRisk || !customerRevenue || !actionability || !dataConfidence || !timeOut) return { ok: false, issues };
  const value: ScoringInputs = {
    cash: cashOut,
    profitability: profOut,
    inventoryExposure: invOut,
    economicAttribution: attributions,
    ...(contextual.length ? { contextualEvidence: contextual } : {}),
    operationalRisk,
    customerRevenue,
    timeSensitivity: timeOut,
    actionability,
    dataConfidence,
    ...(modOut && Object.keys(modOut).length ? { modifiers: modOut } : {}),
    ...(emOut && Object.keys(emOut).length ? { emergency: emOut } : {}),
    ...(preventableLoss !== undefined ? { preventableLoss } : {}),
    ...(actionDeadline ? { actionDeadline } : {}),
    ...(sourceRefs ? { sourceRefs } : {}),
  };
  return { ok: true, issues: [], value };
}
