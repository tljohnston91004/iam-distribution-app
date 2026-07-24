/**
 * Segment-level candidate discovery — aggregates SKU evidence into management issues
 * (classification, vendor, category, department, location, product group, company).
 * Does not recalculate RSE classification; consumes classification dimensions on evidence.
 */

import { cashImpactScore } from "./impact-score";
import {
  actionStrengthFromScore,
  confidenceMultiplier,
  evidenceStrengthFromConfidence,
  readinessFromConfidence,
} from "./confidence";
import { isInvalidPlaceholderLocation, isValidLocationCode } from "@/lib/iam/actions";
import { SERVICE_RISK_OVERRIDE_MIN_RATIO, V1_RANKING_WEIGHTS } from "../constants";
import type { ConfidenceLevel, ScoredCandidate, SkuEvidence } from "../types";

const TRAPPED_CASH_WEEKS = 26;
const MIN_SEGMENT_SKUS = 3;
const MIN_SEGMENT_VALUE = 10_000;

export type SegmentDimension =
  | "classification"
  | "vendor"
  | "category"
  | "department"
  | "location"
  | "product_group"
  | "company";

export type SkuEvidenceWithDims = SkuEvidence & {
  classification?: string | null;
  vendorName?: string | null;
  category?: string | null;
  department?: string | null;
  locationCode?: string | null;
  productGroup?: string | null;
};

function dimValue(ev: SkuEvidenceWithDims, dim: SegmentDimension): string | null {
  if (dim === "company") return null; // handled separately
  const raw =
    dim === "classification"
      ? ev.classification
      : dim === "vendor"
        ? ev.vendorName
        : dim === "category"
          ? ev.category
          : dim === "department"
            ? ev.department
            : dim === "location"
              ? ev.locationCode
              : ev.productGroup;
  const v = raw?.trim();
  if (!v) return null;
  // Location: only validated customer locations (never "0", blank, N/A, etc.)
  if (dim === "location" && !isValidLocationCode(v)) return null;
  // Other dims: ignore non-meaningful placeholder keys
  if (/^(0+|n\/?a|null|none|unknown|-|#)$/i.test(v)) return null;
  return v;
}

function isTrapped(ev: SkuEvidenceWithDims): boolean {
  return (
    ev.weeksOfSupply != null &&
    ev.weeksOfSupply >= TRAPPED_CASH_WEEKS &&
    (ev.inventoryValue ?? 0) >= 500
  );
}

function worstConfidence(levels: string[]): ConfidenceLevel {
  const order = [
    "Insufficient Data",
    "Unknown",
    "Low Confidence",
    "Medium Confidence",
    "High Confidence",
  ];
  let worst = "High Confidence";
  for (const l of levels) {
    if (order.indexOf(l) < order.indexOf(worst)) worst = l;
  }
  return worst as ConfidenceLevel;
}

function buildSegmentCandidate(
  dim: SegmentDimension,
  key: string,
  members: SkuEvidenceWithDims[],
  extras?: Record<string, unknown>
): ScoredCandidate | null {
  if (members.length < MIN_SEGMENT_SKUS) return null;
  const totalValue = members.reduce((s, m) => s + (m.inventoryValue ?? 0), 0);
  if (totalValue < MIN_SEGMENT_VALUE) return null;

  const cashScore = cashImpactScore(totalValue);
  const avgWos =
    members.reduce((s, m) => s + (m.weeksOfSupply ?? 0), 0) / Math.max(members.length, 1);
  const inventoryCondition = Math.min(100, (avgWos / TRAPPED_CASH_WEEKS) * 100);
  const serviceRiskScore = 0;
  const actionability = 75;
  const composite =
    cashScore * V1_RANKING_WEIGHTS.cashImpact +
    serviceRiskScore * V1_RANKING_WEIGHTS.serviceOperationalRisk +
    inventoryCondition * V1_RANKING_WEIGHTS.inventoryCondition +
    actionability * V1_RANKING_WEIGHTS.actionability;
  const conf = worstConfidence(members.map((m) => m.dataConfidence));
  const priorityScore = composite * confidenceMultiplier(conf);
  const segmentId = `segment:${dim}:${key}`;
  const memberSkus = members.map((m) => ({
    skuOrItemId: m.skuOrItemId,
    description: m.description ?? null,
    inventoryValue: m.inventoryValue,
    weeksOfSupply: m.weeksOfSupply,
    recommendedAction: "Pending prescribed action",
  }));

  return {
    skuOrItemId: segmentId,
    sourceType: "Segment Aggregate",
    actionType: "Trapped Cash Review",
    candidateTitle: `Reduce $${Math.round(totalValue).toLocaleString("en-US")} of trapped cash across ${members.length} excess SKUs · ${dimLabel(dim)} "${key}"`,
    evidenceStrength: evidenceStrengthFromConfidence(conf),
    estimatedCashImpact: totalValue,
    serviceOperationalRisk: false,
    serviceRiskScore: 0,
    cashImpactScore: cashScore,
    priorityScore,
    priorityCategory: "new_priority",
    readinessLabel: readinessFromConfidence(conf, true),
    confidenceLevel: conf,
    suppressedFlag: false,
    detail: {
      reason: "segment_excess_inventory",
      analysisGrain: "segment",
      segmentType: dim,
      segmentKey: key,
      affectedSkuCount: members.length,
      totalInventoryValue: totalValue,
      excessValue: totalValue,
      operationalImpact: `${members.length} SKUs with elevated weeks of supply`,
      urgency: avgWos >= 52 ? "high" : "moderate",
      memberSkus,
      memberSkuIds: members.map((m) => m.skuOrItemId),
      doubleCountGuard: "member_skus_excluded_from_same_action_unless_critical",
      actionStrength: actionStrengthFromScore(priorityScore, conf),
      weeksOfSupply: avgWos,
      overrideApplied: false,
      criticalOverride: false,
      ...extras,
    },
  };
}

/**
 * Build segment Trapped Cash Review candidates where aggregate excess exposure
 * materially exceeds typical single-SKU noise.
 *
 * Location "0" / invalid location codes never produce location-level Recommendations.
 * Those SKUs roll into a company/portfolio priority with a data-quality warning.
 */
export function identifySegmentCandidates(skuEvidence: SkuEvidenceWithDims[]): ScoredCandidate[] {
  const dims: SegmentDimension[] = [
    "classification",
    "vendor",
    "category",
    "department",
    "location",
    "product_group",
  ];
  const out: ScoredCandidate[] = [];

  for (const dim of dims) {
    const groups = new Map<string, SkuEvidenceWithDims[]>();
    for (const ev of skuEvidence) {
      const key = dimValue(ev, dim);
      if (!key) continue;
      if (!isTrapped(ev)) continue;
      const list = groups.get(key) ?? [];
      list.push(ev);
      groups.set(key, list);
    }

    for (const [key, members] of groups) {
      const cand = buildSegmentCandidate(dim, key, members);
      if (cand) out.push(cand);
    }
  }

  // Company-level: trapped cash with explicit invalid location placeholders (e.g. Keystroke "0").
  // Missing location alone does not create this segment (those SKUs still aggregate by classification/vendor/etc.).
  const unmapped = skuEvidence.filter(
    (ev) => isTrapped(ev) && isInvalidPlaceholderLocation(ev.locationCode ?? null)
  );
  if (unmapped.length >= MIN_SEGMENT_SKUS) {
    const cand = buildSegmentCandidate("company", "unmapped_location", unmapped, {
      dataQualityWarning:
        'Location codes are invalid placeholders (including source default "0"). Priority presented at company level until location mapping is corrected.',
      locationValidationStatus: "invalid_or_unknown",
    });
    if (cand) out.push(cand);
  }

  return out;
}

function dimLabel(dim: SegmentDimension): string {
  switch (dim) {
    case "classification":
      return "Classification";
    case "vendor":
      return "Vendor";
    case "category":
      return "Category";
    case "department":
      return "Department";
    case "location":
      return "Location";
    case "product_group":
      return "Product group";
    case "company":
      return "Company";
  }
}

/**
 * Drop SKU-level candidates covered by a higher-impact segment of the same action type,
 * unless the SKU has a critical operational override (service/safety/revenue risk).
 */
export function applySegmentDoubleCountGuard(
  skuCandidates: ScoredCandidate[],
  segmentCandidates: ScoredCandidate[]
): ScoredCandidate[] {
  const covered = new Map<string, { segmentImpact: number; actionType: string }>();
  for (const seg of segmentCandidates) {
    const ids = (seg.detail.memberSkuIds as string[]) ?? [];
    for (const id of ids) {
      const prev = covered.get(`${id}|${seg.actionType}`);
      if (!prev || seg.estimatedCashImpact > prev.segmentImpact) {
        covered.set(`${id}|${seg.actionType}`, {
          segmentImpact: seg.estimatedCashImpact,
          actionType: seg.actionType,
        });
      }
    }
  }

  return skuCandidates.filter((c) => {
    const hit = covered.get(`${c.skuOrItemId}|${c.actionType}`);
    if (!hit) return true;
    const critical =
      c.detail?.criticalOverride === true ||
      (c.serviceOperationalRisk &&
        (c.serviceRiskScore ?? 0) / Math.max(c.cashImpactScore ?? 1, 1) >=
          SERVICE_RISK_OVERRIDE_MIN_RATIO);
    if (critical) {
      c.detail = { ...c.detail, keptDespiteSegment: true, criticalOverride: true };
      return true;
    }
    return false;
  });
}
