export type ConfidenceLevel =
  | "High Confidence"
  | "Medium Confidence"
  | "Low Confidence"
  | "Insufficient Data"
  | "Unknown";

export interface SkuEvidence {
  skuOrItemId: string;
  description?: string;
  vendorName?: string | null;
  quantityOnHand: number | null;
  cost: number | null;
  inventoryValue: number | null;
  unitsSold: number | null;
  grossSalesDollars: number | null;
  backorderQuantity: number | null;
  openOrderQuantity: number | null;
  dataConfidence: ConfidenceLevel;
  weeksOfSupply: number | null;
}

export interface ScoredCandidate {
  skuOrItemId: string;
  sourceType: string;
  actionType: string;
  candidateTitle: string;
  evidenceStrength: string;
  estimatedCashImpact: number;
  serviceOperationalRisk: boolean;
  serviceRiskScore: number;
  cashImpactScore: number;
  priorityScore: number;
  priorityCategory: "new_priority" | "holdover";
  readinessLabel: string;
  confidenceLevel: ConfidenceLevel;
  suppressedFlag: boolean;
  /** Vendor / business-case key used for work-package grouping */
  vendorKey?: string;
  detail: Record<string, unknown>;
}

/** Ranked management/execution unit — one or more SKU candidates sharing a business case. */
export interface WorkPackage {
  packageKey: string;
  actionType: string;
  vendorKey: string;
  packageTitle: string;
  leadSkuOrItemId: string;
  childSkuIds: string[];
  sourceType: string;
  evidenceStrength: string;
  estimatedCashImpact: number;
  serviceOperationalRisk: boolean;
  serviceRiskScore: number;
  cashImpactScore: number;
  priorityScore: number;
  priorityCategory: "new_priority" | "holdover";
  readinessLabel: string;
  confidenceLevel: ConfidenceLevel;
  suppressedFlag: boolean;
  members: ScoredCandidate[];
  detail: Record<string, unknown>;
}

export interface RseSignalFlags {
  rootCauseFlag?: boolean;
  classificationIssueFlag?: boolean;
  minMaxIssueFlag?: boolean;
  replenishmentOverbuyRisk?: boolean;
  rseReviewRecommended?: boolean;
}

export interface IfmSignalFlags {
  cashPressureFlag?: boolean;
  fundingConstrainedFlag?: boolean;
  patienceToleranceLow?: boolean;
  inventoryCapitalSeverity?: number;
}
