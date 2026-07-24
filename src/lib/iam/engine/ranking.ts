import {
  SERVICE_RISK_OVERRIDE_MIN_RATIO,
  V1_RANKING_WEIGHTS,
} from "../constants";
import { cashImpactScore, compareByBusinessImpact } from "./impact-score";
import {
  actionStrengthFromScore,
  confidenceMultiplier,
  evidenceStrengthFromConfidence,
  readinessFromConfidence,
} from "./confidence";
import type { IfmSignalFlags, RseSignalFlags, ScoredCandidate, SkuEvidence } from "../types";

const TRAPPED_CASH_WEEKS = 26;
const STOCK_RISK_WEEKS = 2;
const WEAK_DEMAND_WEEKS = 52;

export function buildSkuEvidence(
  sku: string,
  inv?: {
    description?: string | null;
    quantityOnHand: number;
    cost?: number | null;
    inventoryValue?: number | null;
    dataConfidence: string;
    classification?: string | null;
    vendorName?: string | null;
    category?: string | null;
    department?: string | null;
    locationCode?: string | null;
    productGroup?: string | null;
    lastSoldDate?: Date | string | null;
  },
  demand?: { unitsSold: number; grossSalesDollars: number; dataConfidence: string },
  supply?: { backorderQuantity?: number | null; openOrderQuantity?: number | null }
): SkuEvidence {
  const qoh = inv?.quantityOnHand ?? null;
  const cost = inv?.cost ?? null;
  const value =
    inv?.inventoryValue ??
    (qoh != null && cost != null ? qoh * cost : null);
  const unitsSold = demand?.unitsSold ?? null;
  const weeklyUnits = unitsSold != null ? unitsSold / 13 : null;
  const weeksOfSupply =
    qoh != null && weeklyUnits != null && weeklyUnits > 0 ? qoh / weeklyUnits : null;

  return {
    skuOrItemId: sku,
    description: inv?.description ?? undefined,
    quantityOnHand: qoh,
    cost,
    inventoryValue: value,
    unitsSold,
    grossSalesDollars: demand?.grossSalesDollars ?? null,
    backorderQuantity: supply?.backorderQuantity ?? null,
    openOrderQuantity: supply?.openOrderQuantity ?? null,
    dataConfidence: (inv?.dataConfidence ??
      demand?.dataConfidence ??
      "Medium Confidence") as SkuEvidence["dataConfidence"],
    weeksOfSupply,
    classification: inv?.classification ?? null,
    vendorName: inv?.vendorName ?? null,
    category: inv?.category ?? null,
    department: inv?.department ?? null,
    locationCode: inv?.locationCode ?? null,
    productGroup: inv?.productGroup ?? null,
    lastSoldDate: inv?.lastSoldDate ?? null,
  };
}

export function identifyCandidatesForSku(
  evidence: SkuEvidence,
  rse: RseSignalFlags = {},
  ifm: IfmSignalFlags = {}
): ScoredCandidate[] {
  const candidates: ScoredCandidate[] = [];
  const hasRequired =
    evidence.quantityOnHand != null &&
    evidence.unitsSold != null &&
    evidence.grossSalesDollars != null &&
    (evidence.inventoryValue != null || evidence.cost != null);

  const cashImpact = evidence.inventoryValue ?? 0;
  const cashScore = cashImpactScore(cashImpact);

  let serviceRiskScore = 0;
  let serviceRisk = false;
  if (evidence.backorderQuantity != null && evidence.backorderQuantity > 0) {
    serviceRisk = true;
    serviceRiskScore = 70 + Math.min(30, evidence.backorderQuantity);
  } else if (
    evidence.weeksOfSupply != null &&
    evidence.weeksOfSupply <= STOCK_RISK_WEEKS &&
    evidence.quantityOnHand != null &&
    evidence.quantityOnHand > 0
  ) {
    serviceRisk = true;
    serviceRiskScore = 55;
  }
  if (rse.replenishmentOverbuyRisk) serviceRiskScore += 15;
  if (ifm.cashPressureFlag) serviceRiskScore = Math.max(serviceRiskScore, 40);

  serviceRiskScore = Math.min(100, serviceRiskScore);
  if (serviceRisk) serviceRisk = serviceRiskScore >= 40;

  const trappedCash =
    evidence.weeksOfSupply != null &&
    evidence.weeksOfSupply >= TRAPPED_CASH_WEEKS &&
    cashImpact >= 500;

  const weakDemand =
    evidence.weeksOfSupply != null && evidence.weeksOfSupply >= WEAK_DEMAND_WEEKS;

  if (trappedCash || weakDemand || rse.rootCauseFlag || rse.minMaxIssueFlag) {
    candidates.push(
      scoreCandidate({
        evidence,
        actionType: "Trapped Cash Review",
        title: `Trapped cash review — ${evidence.skuOrItemId}${evidence.description ? ` (${evidence.description})` : ""}`,
        cashImpact,
        cashScore,
        serviceRiskScore,
        serviceRisk: false,
        hasRequired,
        reason: trappedCash ? "excess_weeks_of_supply" : "weak_demand_or_rse_signal",
        rse,
        ifm,
      })
    );
  }

  if (serviceRisk) {
    const override =
      serviceRiskScore / Math.max(cashScore, 1) >= SERVICE_RISK_OVERRIDE_MIN_RATIO;
    candidates.push(
      scoreCandidate({
        evidence,
        actionType: "Stock Risk Review",
        title: `Stock risk review — ${evidence.skuOrItemId}`,
        cashImpact: Math.min(cashImpact, serviceRiskScore * 100),
        cashScore,
        serviceRiskScore,
        serviceRisk: true,
        hasRequired,
        reason: override ? "service_override" : "stock_risk",
        rse,
        ifm,
        forceServiceLead: override,
        criticalOverride: override,
      })
    );
  }

  if (rse.minMaxIssueFlag || rse.replenishmentOverbuyRisk) {
    candidates.push(
      scoreCandidate({
        evidence,
        actionType: "Reduce / Pause Replenishment Review",
        title: `Replenishment pause review — ${evidence.skuOrItemId}`,
        cashImpact,
        cashScore,
        serviceRiskScore,
        serviceRisk: false,
        hasRequired,
        reason: "rse_replenishment_pressure",
        rse,
        ifm,
      })
    );
  }

  return dedupeByActionType(candidates);
}

function scoreCandidate(input: {
  evidence: SkuEvidence;
  actionType: string;
  title: string;
  cashImpact: number;
  cashScore: number;
  serviceRiskScore: number;
  serviceRisk: boolean;
  hasRequired: boolean;
  reason: string;
  rse: RseSignalFlags;
  ifm: IfmSignalFlags;
  forceServiceLead?: boolean;
  criticalOverride?: boolean;
}): ScoredCandidate {
  const { evidence } = input;
  const inventoryCondition =
    evidence.weeksOfSupply != null
      ? Math.min(100, (evidence.weeksOfSupply / TRAPPED_CASH_WEEKS) * 100)
      : 30;
  const actionability = input.hasRequired ? 80 : 40;

  let leadCash = input.cashScore;
  let leadService = input.serviceRiskScore;
  const override =
    input.forceServiceLead ||
    (leadService / Math.max(leadCash, 1) >= SERVICE_RISK_OVERRIDE_MIN_RATIO &&
      input.serviceRisk);

  const composite = override
    ? leadService * V1_RANKING_WEIGHTS.serviceOperationalRisk +
      leadCash * V1_RANKING_WEIGHTS.cashImpact +
      inventoryCondition * V1_RANKING_WEIGHTS.inventoryCondition +
      actionability * V1_RANKING_WEIGHTS.actionability
    : leadCash * V1_RANKING_WEIGHTS.cashImpact +
      leadService * V1_RANKING_WEIGHTS.serviceOperationalRisk +
      inventoryCondition * V1_RANKING_WEIGHTS.inventoryCondition +
      actionability * V1_RANKING_WEIGHTS.actionability;

  const confMult = confidenceMultiplier(evidence.dataConfidence);
  const priorityScore = composite * confMult;

  const readiness = readinessFromConfidence(evidence.dataConfidence, input.hasRequired);
  const suppressed =
    readiness === "Insufficient Support for Normal Surfacing" && priorityScore < 25;

  return {
    skuOrItemId: evidence.skuOrItemId,
    sourceType: "Inventory Snapshot",
    actionType: input.actionType,
    candidateTitle: input.title,
    evidenceStrength: evidenceStrengthFromConfidence(evidence.dataConfidence),
    estimatedCashImpact: input.cashImpact,
    serviceOperationalRisk: input.serviceRisk,
    serviceRiskScore: input.serviceRiskScore,
    cashImpactScore: input.cashScore,
    priorityScore,
    priorityCategory: "new_priority",
    readinessLabel: readiness,
    confidenceLevel: evidence.dataConfidence,
    suppressedFlag: suppressed,
    detail: {
      reason: input.reason,
      weeksOfSupply: evidence.weeksOfSupply,
      overrideApplied: override,
      criticalOverride: Boolean(input.criticalOverride || override),
      analysisGrain: "sku",
      actionStrength: actionStrengthFromScore(priorityScore, evidence.dataConfidence),
      rse: input.rse,
      ifm: input.ifm,
      classification: evidence.classification ?? null,
      vendorName: evidence.vendorName ?? null,
    },
  };
}

function dedupeByActionType(candidates: ScoredCandidate[]): ScoredCandidate[] {
  const byType = new Map<string, ScoredCandidate>();
  for (const c of candidates) {
    const key = `${c.skuOrItemId}:${c.actionType}`;
    const existing = byType.get(key);
    if (!existing || c.priorityScore > existing.priorityScore) byType.set(key, c);
  }
  return [...byType.values()];
}

export function rankNewPriorityCandidates(candidates: ScoredCandidate[]): ScoredCandidate[] {
  return [...candidates]
    .filter((c) => !c.suppressedFlag && c.priorityCategory === "new_priority")
    .sort(compareByBusinessImpact);
}

/** Rank by combined financial + operational business impact (segment or SKU). */
export function rankAllPriorityCandidates(candidates: ScoredCandidate[]): ScoredCandidate[] {
  return [...candidates]
    .filter((c) => c.priorityCategory === "new_priority")
    .sort(compareByBusinessImpact);
}

export function assignFeaturedSlots<T extends { featuredSlot?: number | null }>(
  items: T[],
  count: number
): (T & { featuredSlot: number | null })[] {
  return items.map((item, i) => ({
    ...item,
    featuredSlot: i < count ? i + 1 : null,
  }));
}
