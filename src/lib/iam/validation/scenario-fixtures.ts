import {
  buildSkuEvidence,
  identifyCandidatesForSku,
  rankNewPriorityCandidates,
} from "@/lib/iam/engine/ranking";
import type { IfmSignalFlags, RseSignalFlags } from "@/lib/iam/types";

/** Doc 07 sample SKUs — aligned with validation seed route. */
export const FIXTURE_SKU_100_TRAPPED = {
  sku: "SKU-100",
  qoh: 240,
  cost: 85,
  units: 8,
  sales: 640,
  confidence: "Medium Confidence" as const,
};

export const FIXTURE_SKU_200_STOCK = {
  sku: "SKU-200",
  qoh: 12,
  cost: 42,
  units: 180,
  sales: 7560,
  backorder: 24,
  confidence: "Medium Confidence" as const,
};

export const FIXTURE_SKU_210_OVERRIDE = {
  sku: "SKU-210",
  qoh: 8,
  cost: 55,
  units: 200,
  sales: 11000,
  backorder: 80,
  confidence: "Medium Confidence" as const,
};

export const FIXTURE_SKU_500_LOW_CONF = {
  sku: "SKU-500",
  qoh: 120,
  cost: 40,
  units: 6,
  sales: 240,
  confidence: "Low Confidence" as const,
};

export function scoreFixture(
  f: {
    sku: string;
    qoh: number;
    cost: number;
    units: number;
    sales: number;
    backorder?: number;
    vendor?: string;
    confidence: "Medium Confidence" | "Low Confidence" | "Insufficient Support";
  },
  rse: RseSignalFlags = {},
  ifm: IfmSignalFlags = {}
) {
  const evidence = buildSkuEvidence(
    f.sku,
    {
      quantityOnHand: f.qoh,
      cost: f.cost,
      inventoryValue: f.qoh * f.cost,
      dataConfidence: f.confidence,
      vendorName: f.vendor,
    },
    { unitsSold: f.units, grossSalesDollars: f.sales, dataConfidence: f.confidence },
    f.backorder != null ? { backorderQuantity: f.backorder } : undefined
  );
  return identifyCandidatesForSku(evidence, rse, ifm);
}

export function rankFixtures(
  fixtures: ReturnType<typeof scoreFixture>[]
) {
  return rankNewPriorityCandidates(fixtures.flat());
}
