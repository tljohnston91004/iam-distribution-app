/**
 * Canonical inbound contracts — ADR-IAM-001.
 * No Keystroke (or Hub) imports allowed in this module.
 */

export type QuantityBasisUsed = "available_qoh" | "on_hand";

export type EntityEligibility = "rankable" | "excluded_non_entity";

export type GenerationPath = "module" | "interim_evidence";

/** Interim SD-13 / EEP presentation categories (Decision Board lanes — not lifecycle states). */
export type PresentationCategory =
  | "top_2" // legacy alias — treat as active_priority when reading
  | "active_priority"
  | "waiting_activation"
  | "emergency"
  | "holdover"
  | "deferred"
  | "managed_backlog"
  | "completed_presentation"
  | "archived_history";

export interface EvidenceItemInput {
  skuOrItemId: string;
  description?: string | null;
  quantityOnHand?: number | null;
  availableQoh?: number | null;
  /** If omitted, derived per ADR-IAM-001 / SD-15 when inventory quantities present. */
  quantityBasisUsed?: QuantityBasisUsed | null;
  unitCost?: number | null;
  openOrderQty?: number | null;
  backorderQuantity?: number | null;
  lastSoldDate?: string | null;
  lastReceivedDate?: string | null;
  periodCode?: string | null;
  unitsSold?: number | null;
  salesDollars?: number | null;
  entityEligibility?: EntityEligibility;
  dataConfidence?: string | null;
  /** Optional source row/record reference for provenance (adapter-supplied). */
  sourceRowRef?: string | null;
  /** Optional dimensional attributes (RSE classification / inventory class / Hub). */
  classification?: string | null;
  vendorName?: string | null;
  category?: string | null;
  department?: string | null;
  locationCode?: string | null;
  productGroup?: string | null;
  itemStatus?: string | null;
}

export interface EvidencePackageInput {
  reviewCycleId: string;
  evidenceBatchKey: string;
  sourceSystem: string;
  sourceReportType: string;
  /** Optional original source filename (adapter / Hub). */
  sourceFileName?: string | null;
  asOfTimestamp?: string | null;
  contentIdentity?: string | null;
  items: EvidenceItemInput[];
  requestId?: string;
  performedBy?: string;
}

export interface RecommendationPackageItem {
  sourceModule: string;
  sourceRecommendationId?: string | null;
  generationPath?: GenerationPath;
  opportunityKey?: string | null;
  skuOrItemId?: string | null;
  recommendationType: string;
  title: string;
  confidence?: string | null;
  estimatedFinancialImpact?: number | null;
  estimatedCashImpact?: number | null;
  costOfInaction?: number | null;
  explainability?: Record<string, unknown> | null;
  evidenceRefs?: unknown;
  sourcePayloadHash?: string | null;
  presentationCategory?: PresentationCategory | null;
  /** Interim SD-13 presentation order within category (optional). */
  presentationRank?: number | null;
  analysisGrain?: "sku" | "segment" | null;
  segmentType?: string | null;
  segmentKey?: string | null;
  affectedSkuCount?: number | null;
}

export interface RecommendationBatchInput {
  reviewCycleId: string;
  recommendations: RecommendationPackageItem[];
  requestId?: string;
  performedBy?: string;
}

export function deriveQuantityBasis(
  availableQoh: number | null | undefined,
  quantityOnHand: number | null | undefined,
  explicit?: QuantityBasisUsed | null
): { basis: QuantityBasisUsed | null; usableQty: number | null } {
  if (explicit === "available_qoh" && availableQoh != null) {
    return { basis: "available_qoh", usableQty: availableQoh };
  }
  if (explicit === "on_hand" && quantityOnHand != null) {
    return { basis: "on_hand", usableQty: quantityOnHand };
  }
  if (availableQoh != null) {
    return { basis: "available_qoh", usableQty: availableQoh };
  }
  if (quantityOnHand != null) {
    return { basis: "on_hand", usableQty: quantityOnHand };
  }
  return { basis: null, usableQty: null };
}

export function buildOpportunityKey(input: {
  opportunityKey?: string | null;
  skuOrItemId?: string | null;
  recommendationType: string;
}): string {
  if (input.opportunityKey?.trim()) return input.opportunityKey.trim();
  const sku = (input.skuOrItemId ?? "").trim() || "unknown";
  return `${sku}|${input.recommendationType}`;
}
