/**
 * IAM Prescribed Action Plan — evidence-based corrective actions.
 * Consumes available evidence; does not recalculate RSE classification or Min/Max engines.
 * Governance / lifecycle / OEC / EEP are unchanged — this extends Recommendation content only.
 */

import type { ConfidenceLevel, SkuEvidence } from "@/lib/iam/types";

export type PrescribedActionCode =
  | "return_to_vendor"
  | "transfer_location"
  | "stop_reduce_replenishment"
  | "freeze_purchasing"
  | "correct_minmax"
  | "bundle_with_stronger"
  | "promotional_markdown"
  | "customer_specific_sale"
  | "sales_team_focus"
  | "vendor_negotiation"
  | "liquidation"
  | "discontinue"
  | "hold_and_monitor"
  | "data_correction_review"
  | "management_review_needed";

export const PRESCRIBED_ACTION_LABELS: Record<PrescribedActionCode, string> = {
  return_to_vendor: "Return to vendor",
  transfer_location: "Transfer to another location",
  stop_reduce_replenishment: "Stop or reduce replenishment",
  freeze_purchasing: "Freeze purchasing",
  correct_minmax: "Correct Min/Max settings",
  bundle_with_stronger: "Bundle with stronger products",
  promotional_markdown: "Promotional markdown",
  customer_specific_sale: "Customer-specific sale",
  sales_team_focus: "Sales-team focus",
  vendor_negotiation: "Vendor negotiation",
  liquidation: "Liquidation",
  discontinue: "Discontinue",
  hold_and_monitor: "Hold and monitor",
  data_correction_review: "Data correction or further review",
  management_review_needed: "Management review / additional data required",
};

export type SkuActionInput = SkuEvidence & {
  lastSoldDate?: Date | string | null;
  openPurchaseOrders?: number | null;
  returnabilityKnown?: boolean | null;
  strategicImportance?: "high" | "normal" | "low" | null;
  productStatus?: string | null;
  rseMinMaxIssue?: boolean;
  rseOverbuyRisk?: boolean;
};

export type SkuActionPrescription = {
  skuOrItemId: string;
  actionCode: PrescribedActionCode;
  actionLabel: string;
  reason: string;
  inventoryValue: number | null;
  weeksOfSupply: number | null;
  dataGaps: string[];
  confidence: ConfidenceLevel;
};

export type ActionGroup = {
  actionCode: PrescribedActionCode;
  actionLabel: string;
  skuCount: number;
  excessValue: number;
  skus: {
    skuOrItemId: string;
    inventoryValue: number | null;
    reason: string;
  }[];
};

export type PrescribedActionPlan = {
  version: "iam_v15_prescribed_action_plan_v1";
  recommendedManagementAction: string;
  reasonSelected: string;
  immediateNextSteps: string[];
  affectedPopulation: {
    analysisGrain: "sku" | "segment";
    skuCount: number;
    totalInventoryValue: number;
    segmentType?: string | null;
    segmentKey?: string | null;
    locationValidation?: {
      status: "valid" | "invalid_or_unknown" | "not_applicable";
      rawValue?: string | null;
      message?: string;
    };
  };
  actionGroups: ActionGroup[];
  executionSequence: string[];
  ownerRole: string;
  targetCompletionPeriod: string;
  expectedFinancialResult: string;
  expectedOperationalResult: string;
  successMeasures: string[];
  risksAndCautions: string[];
  dataGapsOrDecisionsRequired: string[];
  alternativeActions: string[];
  dataConfidence: string;
  summaryLine: string;
};

/** Reject source-system placeholders incorrectly labeled as locations — unless sole primary. */
export type LocationCodeContext = {
  /** Distinct trimmed non-blank location codes observed in this cycle's evidence. */
  distinctLocationCodes: string[];
};

export function buildLocationCodeContext(
  codes: Array<string | null | undefined>
): LocationCodeContext {
  const set = new Set<string>();
  for (const c of codes) {
    const v = c == null ? "" : String(c).trim();
    if (v) set.add(v);
  }
  return { distinctLocationCodes: [...set].sort() };
}

function isPlaceholderLocationForm(v: string): boolean {
  return /^(0+|n\/?a|null|none|unknown|-|#|company|all|hq)$/i.test(v);
}

/**
 * Keystroke / single-site distributors often send location "0" as the only location.
 * When every observed location code is that same placeholder, treat it as home/primary.
 */
export function isSolePrimaryLocation(
  raw: string | null | undefined,
  ctx?: LocationCodeContext | null
): boolean {
  if (!ctx?.distinctLocationCodes.length) return false;
  const v = raw == null ? "" : String(raw).trim();
  if (!v) return false;
  if (ctx.distinctLocationCodes.length !== 1) return false;
  if (ctx.distinctLocationCodes[0] !== v) return false;
  return isPlaceholderLocationForm(v);
}

export function isValidLocationCode(
  raw: string | null | undefined,
  ctx?: LocationCodeContext | null
): boolean {
  if (raw == null) return false;
  const v = String(raw).trim();
  if (!v) return false;
  if (isPlaceholderLocationForm(v)) {
    // Sole location in the dataset (e.g. Keystroke "0" for a one-site company) = home/primary.
    return isSolePrimaryLocation(v, ctx);
  }
  return true;
}

/** True when a location field is present but is a known invalid/default placeholder (e.g. "0"). */
export function isInvalidPlaceholderLocation(
  raw: string | null | undefined,
  ctx?: LocationCodeContext | null
): boolean {
  if (raw == null) return false;
  const v = String(raw).trim();
  if (!v) return false;
  return !isValidLocationCode(v, ctx);
}

/** Display label for Board titles — "Home (primary)" when "0" is sole site. */
export function locationDisplayLabel(
  raw: string | null | undefined,
  ctx?: LocationCodeContext | null
): string {
  const v = raw == null ? "" : String(raw).trim();
  if (!v) return "blank";
  if (isSolePrimaryLocation(v, ctx)) return "Home (primary)";
  return v;
}

export function locationValidationMessage(
  raw: string | null | undefined,
  ctx?: LocationCodeContext | null
): string {
  const v = raw == null ? "" : String(raw).trim();
  if (isSolePrimaryLocation(v, ctx)) {
    return `Location "${v}" accepted as the home/primary location (only location present in this dataset — typical for single-site Keystroke files).`;
  }
  if (!v || isPlaceholderLocationForm(v)) {
    return `Location "${v || "blank"}" is not a validated customer location — likely a source default, missing mapping, or company-level aggregate incorrectly labeled as a location. Present at company/portfolio level until corrected.`;
  }
  if (!isValidLocationCode(v, ctx)) {
    return `Location "${v}" failed validation and must not drive a location-level Recommendation.`;
  }
  return `Location "${v}" accepted as a location key.`;
}

function daysSince(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

/**
 * Prescribe a SKU-level corrective action from available evidence.
 * When evidence is insufficient, returns management_review_needed / data_correction_review.
 */
export function prescribeSkuAction(
  ev: SkuActionInput,
  locationCtx?: LocationCodeContext | null
): SkuActionPrescription {
  const gaps: string[] = [];
  const value = ev.inventoryValue ?? 0;
  const wos = ev.weeksOfSupply;
  const lastSoldDays = daysSince(ev.lastSoldDate);
  const classCode = (ev.classification ?? "").trim().toUpperCase();
  const hasDemand = ev.unitsSold != null && ev.unitsSold > 0;
  const openPo = ev.openPurchaseOrders ?? ev.openOrderQuantity ?? 0;
  const confidence = ev.dataConfidence;

  if (!ev.classification) gaps.push("Inventory classification missing");
  if (ev.lastSoldDate == null) gaps.push("Last sale date missing");
  if (!hasDemand && ev.unitsSold == null) gaps.push("Demand history missing");
  if (!isValidLocationCode(ev.locationCode ?? null, locationCtx) && ev.locationCode) {
    gaps.push(`Location code "${ev.locationCode}" invalid or unknown`);
  }

  // Insufficient evidence → do not invent unsupported actions
  if (ev.quantityOnHand == null || (ev.inventoryValue == null && ev.cost == null)) {
    return {
      skuOrItemId: ev.skuOrItemId,
      actionCode: "data_correction_review",
      actionLabel: PRESCRIBED_ACTION_LABELS.data_correction_review,
      reason: "Required inventory quantity/value evidence is incomplete",
      inventoryValue: ev.inventoryValue,
      weeksOfSupply: wos,
      dataGaps: gaps,
      confidence,
    };
  }

  if (ev.rseMinMaxIssue) {
    return {
      skuOrItemId: ev.skuOrItemId,
      actionCode: "correct_minmax",
      actionLabel: PRESCRIBED_ACTION_LABELS.correct_minmax,
      reason: "RSE signal indicates Min/Max settings likely mis-set",
      inventoryValue: ev.inventoryValue,
      weeksOfSupply: wos,
      dataGaps: gaps,
      confidence,
    };
  }

  // Stock risk path (service)
  if (ev.backorderQuantity != null && ev.backorderQuantity > 0) {
    return {
      skuOrItemId: ev.skuOrItemId,
      actionCode: "sales_team_focus",
      actionLabel: PRESCRIBED_ACTION_LABELS.sales_team_focus,
      reason: "Backorder / stock-risk exposure — prioritize recovery of service before cash actions",
      inventoryValue: ev.inventoryValue,
      weeksOfSupply: wos,
      dataGaps: gaps,
      confidence,
    };
  }

  if (openPo > 0 && wos != null && wos >= 26) {
    return {
      skuOrItemId: ev.skuOrItemId,
      actionCode: "freeze_purchasing",
      actionLabel: PRESCRIBED_ACTION_LABELS.freeze_purchasing,
      reason: "Elevated weeks of supply with open purchase orders — stop adding inventory",
      inventoryValue: ev.inventoryValue,
      weeksOfSupply: wos,
      dataGaps: gaps,
      confidence,
    };
  }

  if (ev.rseOverbuyRisk || (wos != null && wos >= 26 && hasDemand)) {
    return {
      skuOrItemId: ev.skuOrItemId,
      actionCode: "stop_reduce_replenishment",
      actionLabel: PRESCRIBED_ACTION_LABELS.stop_reduce_replenishment,
      reason: "Excess cover vs demand — reduce or pause replenishment before deeper disposition",
      inventoryValue: ev.inventoryValue,
      weeksOfSupply: wos,
      dataGaps: gaps,
      confidence,
    };
  }

  // Deep excess / aged
  const aged = lastSoldDays != null && lastSoldDays >= 180;
  const deepExcess = wos != null && wos >= 52;
  const dClass = classCode.startsWith("D") || classCode === "E" || classCode === "X";

  if (deepExcess && aged && dClass) {
    return {
      skuOrItemId: ev.skuOrItemId,
      actionCode: "liquidation",
      actionLabel: PRESCRIBED_ACTION_LABELS.liquidation,
      reason: "Deep excess, aged last sale, and low-velocity classification — recovery via liquidation",
      inventoryValue: ev.inventoryValue,
      weeksOfSupply: wos,
      dataGaps: gaps,
      confidence,
    };
  }

  if (deepExcess && aged && !ev.vendorName) {
    return {
      skuOrItemId: ev.skuOrItemId,
      actionCode: "promotional_markdown",
      actionLabel: PRESCRIBED_ACTION_LABELS.promotional_markdown,
      reason: "Aged excess without vendor return path on file — promotional exit",
      inventoryValue: ev.inventoryValue,
      weeksOfSupply: wos,
      dataGaps: [...gaps, "Vendor returnability not confirmed"],
      confidence,
    };
  }

  if (deepExcess && ev.vendorName) {
    if (ev.returnabilityKnown === true) {
      return {
        skuOrItemId: ev.skuOrItemId,
        actionCode: "return_to_vendor",
        actionLabel: PRESCRIBED_ACTION_LABELS.return_to_vendor,
        reason: "Deep excess with vendor identified and returnability indicated",
        inventoryValue: ev.inventoryValue,
        weeksOfSupply: wos,
        dataGaps: gaps,
        confidence,
      };
    }
    return {
      skuOrItemId: ev.skuOrItemId,
      actionCode: "vendor_negotiation",
      actionLabel: PRESCRIBED_ACTION_LABELS.vendor_negotiation,
      reason: "Deep excess with vendor on file — negotiate return, credit, or buyback (returnability not confirmed)",
      inventoryValue: ev.inventoryValue,
      weeksOfSupply: wos,
      dataGaps: [...gaps, "Returnability not confirmed in evidence"],
      confidence,
    };
  }

  if (wos != null && wos >= 26 && hasDemand && value >= 5000) {
    return {
      skuOrItemId: ev.skuOrItemId,
      actionCode: "promotional_markdown",
      actionLabel: PRESCRIBED_ACTION_LABELS.promotional_markdown,
      reason: "Material trapped cash with residual demand — accelerate sell-through",
      inventoryValue: ev.inventoryValue,
      weeksOfSupply: wos,
      dataGaps: gaps,
      confidence,
    };
  }

  if (wos != null && wos >= 26 && !hasDemand) {
    if (gaps.length >= 2) {
      return {
        skuOrItemId: ev.skuOrItemId,
        actionCode: "management_review_needed",
        actionLabel: PRESCRIBED_ACTION_LABELS.management_review_needed,
        reason: "Excess indicated but demand/classification evidence incomplete — do not prescribe disposition yet",
        inventoryValue: ev.inventoryValue,
        weeksOfSupply: wos,
        dataGaps: gaps,
        confidence,
      };
    }
    return {
      skuOrItemId: ev.skuOrItemId,
      actionCode: "discontinue",
      actionLabel: PRESCRIBED_ACTION_LABELS.discontinue,
      reason: "No recent demand evidence with elevated cover — discontinue replenishment path and exit stock",
      inventoryValue: ev.inventoryValue,
      weeksOfSupply: wos,
      dataGaps: gaps,
      confidence,
    };
  }

  if (wos != null && wos >= 26) {
    return {
      skuOrItemId: ev.skuOrItemId,
      actionCode: "hold_and_monitor",
      actionLabel: PRESCRIBED_ACTION_LABELS.hold_and_monitor,
      reason: "Elevated cover but insufficient signal for aggressive disposition — monitor with purchasing freeze review",
      inventoryValue: ev.inventoryValue,
      weeksOfSupply: wos,
      dataGaps: gaps,
      confidence,
    };
  }

  return {
    skuOrItemId: ev.skuOrItemId,
    actionCode: "management_review_needed",
    actionLabel: PRESCRIBED_ACTION_LABELS.management_review_needed,
    reason: "Available evidence does not support a specific disposition — management review required",
    inventoryValue: ev.inventoryValue,
    weeksOfSupply: wos,
    dataGaps: gaps.length ? gaps : ["Actionability evidence incomplete"],
    confidence,
  };
}

function groupPrescriptions(prescriptions: SkuActionPrescription[]): ActionGroup[] {
  const map = new Map<PrescribedActionCode, ActionGroup>();
  for (const p of prescriptions) {
    const g = map.get(p.actionCode) ?? {
      actionCode: p.actionCode,
      actionLabel: p.actionLabel,
      skuCount: 0,
      excessValue: 0,
      skus: [],
    };
    g.skuCount += 1;
    g.excessValue += p.inventoryValue ?? 0;
    g.skus.push({
      skuOrItemId: p.skuOrItemId,
      inventoryValue: p.inventoryValue,
      reason: p.reason,
    });
    map.set(p.actionCode, g);
  }
  return [...map.values()].sort((a, b) => b.excessValue - a.excessValue);
}

function usd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function buildPrescribedActionPlan(input: {
  analysisGrain: "sku" | "segment";
  actionType: string;
  titleHint?: string;
  segmentType?: string | null;
  segmentKey?: string | null;
  members: SkuActionInput[];
  locationValidation?: PrescribedActionPlan["affectedPopulation"]["locationValidation"];
  locationCtx?: LocationCodeContext | null;
}): PrescribedActionPlan {
  const prescriptions = input.members.map((m) => prescribeSkuAction(m, input.locationCtx));
  const groups = groupPrescriptions(prescriptions);
  const totalValue = input.members.reduce((s, m) => s + (m.inventoryValue ?? 0), 0);
  const skuCount = input.members.length;
  const dominant = groups[0];
  const gapSet = new Set<string>();
  for (const p of prescriptions) for (const g of p.dataGaps) gapSet.add(g);
  if (input.locationValidation?.status === "invalid_or_unknown" && input.locationValidation.message) {
    gapSet.add(input.locationValidation.message);
  }

  const needsDataFirst = groups.every(
    (g) =>
      g.actionCode === "management_review_needed" || g.actionCode === "data_correction_review"
  );

  const recommendedManagementAction = needsDataFirst
    ? `Complete evidence review before disposition — ${skuCount} SKU(s), ${usd(totalValue)} exposure`
    : input.analysisGrain === "segment"
      ? `Launch a trapped-cash reduction program for ${usd(totalValue)} across ${skuCount} SKUs` +
        (dominant ? `, led by "${dominant.actionLabel}" for the largest share` : "")
      : dominant
        ? `${dominant.actionLabel} for ${input.members[0]?.skuOrItemId ?? "SKU"} (${usd(totalValue)})`
        : `Management review for ${usd(totalValue)} exposure`;

  const reasonSelected = needsDataFirst
    ? "Required evidence is incomplete; IAM will not prescribe an unsupported disposition"
    : dominant
      ? `Largest recoverable exposure group is "${dominant.actionLabel}" (${dominant.skuCount} SKUs, ${usd(dominant.excessValue)}) based on weeks of supply, demand, age, classification, vendor, and open supply signals`
      : "Composite evidence indicates management attention is required";

  const immediateNextSteps = needsDataFirst
    ? [
        "List missing fields (classification, last sale, demand, location mapping).",
        "Assign data owner to correct source extracts.",
        "Re-run IAM Calculate after evidence approval.",
      ]
    : [
        "Validate the affected inventory population and exclude non-entities.",
        "Rank SKUs by excess value, age, future demand signal, margin proxy, and recoverability.",
        `Begin with SKUs representing the largest portion of trapped cash` +
          (dominant ? ` (start: ${dominant.actionLabel})` : "") +
          ".",
        "Group remaining SKUs by prescribed action and assign owners + target dates.",
        "Track inventory reduction, cash recovered, margin impact, and unresolved exposure weekly.",
      ];

  const executionSequence = needsDataFirst
    ? [
        "1. Close data gaps",
        "2. Re-approve evidence",
        "3. Re-calculate and re-present priorities",
        "4. Only then approve disposition actions",
      ]
    : [
        "1. Validate affected inventory and location/company scope",
        "2. Rank SKUs by excess value, age, demand, margin, recoverability",
        "3. Execute highest-value action group first",
        "4. Run secondary groups (markdown, vendor, discontinue) in parallel where safe",
        "5. Assign owners and target dates",
        "6. Measure results weekly until target completion",
      ];

  const alternatives: string[] = groups
    .slice(1, 4)
    .map((g) => `${g.actionLabel} (${g.skuCount} SKUs, ${usd(g.excessValue)})`);
  if (!alternatives.length && !needsDataFirst) {
    alternatives.push(
      "Hold and monitor with purchasing freeze if demand recovers",
      "Escalate to vendor negotiation if markdown recovery is weak"
    );
  }

  const conf =
    prescriptions.map((p) => p.confidence).sort((a, b) => {
      const order = [
        "Insufficient Data",
        "Unknown",
        "Low Confidence",
        "Medium Confidence",
        "High Confidence",
      ];
      return order.indexOf(a) - order.indexOf(b);
    })[0] ?? "Medium Confidence";

  const summaryLine = needsDataFirst
    ? `Action plan blocked on data gaps — ${skuCount} SKUs / ${usd(totalValue)}`
    : `${recommendedManagementAction}`;

  return {
    version: "iam_v15_prescribed_action_plan_v1",
    recommendedManagementAction,
    reasonSelected,
    immediateNextSteps,
    affectedPopulation: {
      analysisGrain: input.analysisGrain,
      skuCount,
      totalInventoryValue: totalValue,
      segmentType: input.segmentType ?? null,
      segmentKey: input.segmentKey ?? null,
      locationValidation: input.locationValidation ?? {
        status: "not_applicable",
      },
    },
    actionGroups: groups.map((g) => ({
      ...g,
      // Cap drill-down size in stored plan; full list remains available via member prescriptions in UI window
      skus: g.skus.slice(0, 25),
    })),
    executionSequence,
    ownerRole: needsDataFirst ? "Operations / Data steward" : "Inventory Manager (primary) with Sales & Purchasing support",
    targetCompletionPeriod: needsDataFirst ? "14 days to close data gaps" : "90-day trapped-cash reduction program",
    expectedFinancialResult: needsDataFirst
      ? "No financial recovery claimed until evidence supports disposition"
      : `Reduce trapped cash exposure of approximately ${usd(totalValue)} (recoverable portion depends on action mix and margin)`,
    expectedOperationalResult: needsDataFirst
      ? "Cleaner evidence for a subsequent actionable priority"
      : "Lower weeks of supply, fewer excess SKUs, controlled replenishment, clearer owner accountability",
    successMeasures: [
      "Inventory value reduced in the affected population",
      "Cash recovered / working capital released",
      "Margin impact of markdowns and liquidations",
      "Open PO and replenishment actions completed",
      "Unresolved excess $ remaining at period end",
    ],
    risksAndCautions: [
      "Do not double-count cash impact across the segment priority and member SKU actions",
      "Validate service risk before aggressive disposition on dual-role SKUs",
      "Confirm vendor return terms before return-to-vendor execution",
      ...(input.locationValidation?.status === "invalid_or_unknown"
        ? ["Location key failed validation — treat as company-level until mapping corrected"]
        : []),
    ],
    dataGapsOrDecisionsRequired: [...gapSet],
    alternativeActions: alternatives,
    dataConfidence: conf,
    summaryLine,
  };
}
