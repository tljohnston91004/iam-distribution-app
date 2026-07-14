import {
  SERVICE_RISK_OVERRIDE_MIN_RATIO,
  V1_RANKING_WEIGHTS,
} from "../constants";
import {
  actionStrengthFromScore,
  confidenceMultiplier,
  evidenceStrengthFromConfidence,
  readinessFromConfidence,
} from "./confidence";
import type {
  IfmSignalFlags,
  RseSignalFlags,
  ScoredCandidate,
  SkuEvidence,
  WorkPackage,
} from "../types";

const TRAPPED_CASH_WEEKS = 26;
const STOCK_RISK_WEEKS = 2;
const WEAK_DEMAND_WEEKS = 52;

export const UNASSIGNED_VENDOR_KEY = "_unassigned";

export function normalizeVendorKey(vendorName?: string | null): string {
  const trimmed = vendorName?.trim();
  return trimmed ? trimmed : UNASSIGNED_VENDOR_KEY;
}

export function buildSkuEvidence(
  sku: string,
  inv?: {
    description?: string | null;
    vendorName?: string | null;
    quantityOnHand: number;
    cost?: number | null;
    inventoryValue?: number | null;
    dataConfidence: string;
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
    vendorName: inv?.vendorName ?? null,
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
  const cashScore = Math.min(100, Math.log10(Math.max(cashImpact, 1) + 1) * 25);

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
    vendorKey: normalizeVendorKey(evidence.vendorName),
    detail: {
      reason: input.reason,
      weeksOfSupply: evidence.weeksOfSupply,
      overrideApplied: override,
      actionStrength: actionStrengthFromScore(priorityScore, evidence.dataConfidence),
      vendorKey: normalizeVendorKey(evidence.vendorName),
      rse: input.rse,
      ifm: input.ifm,
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
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

/**
 * Collapse SKU-level candidates into work packages:
 * same action type + vendor/business case → one package with many child SKUs.
 */
export function groupCandidatesIntoWorkPackages(candidates: ScoredCandidate[]): WorkPackage[] {
  const ranked = rankNewPriorityCandidates(candidates);
  const buckets = new Map<string, ScoredCandidate[]>();

  for (const c of ranked) {
    const vendorKey = c.vendorKey ?? normalizeVendorKey(
      typeof c.detail.vendorKey === "string" ? c.detail.vendorKey : null
    );
    const key = `${c.actionType}::${vendorKey}`;
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }

  const packages: WorkPackage[] = [];
  for (const [packageKey, members] of buckets) {
    const sorted = [...members].sort((a, b) => b.priorityScore - a.priorityScore);
    const lead = sorted[0];
    if (!lead) continue;

    const vendorKey = lead.vendorKey ?? UNASSIGNED_VENDOR_KEY;
    const childSkuIds = sorted.map((m) => m.skuOrItemId);
    const estimatedCashImpact = sorted.reduce((sum, m) => sum + (m.estimatedCashImpact || 0), 0);
    const serviceRiskScore = Math.max(...sorted.map((m) => m.serviceRiskScore));
    const cashImpactScore = Math.max(...sorted.map((m) => m.cashImpactScore));
    const avgPriority =
      sorted.reduce((sum, m) => sum + m.priorityScore, 0) / Math.max(sorted.length, 1);
    // Lead score dominates; package breadth (more SKUs / cash) boosts without drowning focus.
    const breadthBonus = Math.min(18, Math.log10(Math.max(childSkuIds.length, 1)) * 10);
    const cashBonus = Math.min(12, Math.log10(Math.max(estimatedCashImpact, 1) + 1) * 3);
    const priorityScore = lead.priorityScore * 0.7 + avgPriority * 0.3 + breadthBonus + cashBonus;

    const confOrder = ["High Confidence", "Medium Confidence", "Low Confidence", "Insufficient Data", "Unknown"];
    const confidenceLevel = sorted.reduce((worst, m) => {
      return confOrder.indexOf(m.confidenceLevel) > confOrder.indexOf(worst)
        ? m.confidenceLevel
        : worst;
    }, lead.confidenceLevel);

    const readinessLabel = sorted.some((m) => m.readinessLabel.includes("Insufficient"))
      ? "Insufficient Support for Normal Surfacing"
      : sorted.some((m) => m.readinessLabel.includes("Limitation"))
        ? "Ready with Limitations"
        : lead.readinessLabel;

    const vendorLabel =
      vendorKey === UNASSIGNED_VENDOR_KEY ? "mixed / unassigned vendor" : vendorKey;
    const packageTitle =
      childSkuIds.length === 1
        ? lead.candidateTitle
        : `${lead.actionType} — ${vendorLabel} (${childSkuIds.length} SKUs)`;

    packages.push({
      packageKey,
      actionType: lead.actionType,
      vendorKey,
      packageTitle,
      leadSkuOrItemId: lead.skuOrItemId,
      childSkuIds,
      sourceType: lead.sourceType,
      evidenceStrength: lead.evidenceStrength,
      estimatedCashImpact,
      serviceOperationalRisk: sorted.some((m) => m.serviceOperationalRisk),
      serviceRiskScore,
      cashImpactScore,
      priorityScore,
      priorityCategory: "new_priority",
      readinessLabel,
      confidenceLevel,
      suppressedFlag: false,
      members: sorted,
      detail: {
        unit: "work_package",
        packageKey,
        vendorKey,
        childCount: childSkuIds.length,
        childSkuIds,
        leadSkuOrItemId: lead.skuOrItemId,
        actionStrength: actionStrengthFromScore(priorityScore, confidenceLevel),
        memberReasons: sorted.map((m) => ({
          skuOrItemId: m.skuOrItemId,
          reason: m.detail.reason,
          priorityScore: m.priorityScore,
          estimatedCashImpact: m.estimatedCashImpact,
        })),
      },
    });
  }

  return packages.sort((a, b) => b.priorityScore - a.priorityScore);
}

export function rankWorkPackages(packages: WorkPackage[]): WorkPackage[] {
  return [...packages]
    .filter((p) => !p.suppressedFlag && p.priorityCategory === "new_priority")
    .sort((a, b) => b.priorityScore - a.priorityScore);
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
