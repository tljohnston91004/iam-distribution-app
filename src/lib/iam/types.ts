export type ConfidenceLevel =
  | "High Confidence"
  | "Medium Confidence"
  | "Low Confidence"
  | "Insufficient Data"
  | "Unknown";

export interface SkuEvidence {
  skuOrItemId: string;
  description?: string;
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
