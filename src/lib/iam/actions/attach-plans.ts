/**
 * Attach required Prescribed Action Plans to scored candidates (SKU + segment).
 */

import {
  buildPrescribedActionPlan,
  isValidLocationCode,
  locationValidationMessage,
  prescribeSkuAction,
  type PrescribedActionPlan,
  type SkuActionInput,
} from "@/lib/iam/actions";
import type { ScoredCandidate } from "@/lib/iam/types";

function usd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function toActionInput(
  ev: SkuActionInput,
  extras?: Partial<SkuActionInput>
): SkuActionInput {
  return { ...ev, ...extras };
}

/**
 * Enrich candidates with prescribedActionPlan on detail + action-oriented titles for cash issues.
 */
export function attachPrescribedActionPlans(
  candidates: ScoredCandidate[],
  evidenceBySku: Map<string, SkuActionInput>
): ScoredCandidate[] {
  return candidates.map((c) => {
    const isSegment = c.detail?.analysisGrain === "segment";
    const memberIds = (c.detail?.memberSkuIds as string[] | undefined) ?? [];
    const members: SkuActionInput[] = isSegment
      ? memberIds
          .map((id) => evidenceBySku.get(id))
          .filter((m): m is SkuActionInput => Boolean(m))
      : (() => {
          const one = evidenceBySku.get(c.skuOrItemId);
          return one ? [one] : [];
        })();

    if (!members.length) {
      const stubPlan = buildPrescribedActionPlan({
        analysisGrain: isSegment ? "segment" : "sku",
        actionType: c.actionType,
        segmentType: isSegment ? String(c.detail.segmentType ?? "") : null,
        segmentKey: isSegment ? String(c.detail.segmentKey ?? "") : null,
        members: [
          {
            skuOrItemId: c.skuOrItemId,
            quantityOnHand: null,
            cost: null,
            inventoryValue: c.estimatedCashImpact,
            unitsSold: null,
            grossSalesDollars: null,
            backorderQuantity: null,
            openOrderQuantity: null,
            dataConfidence: c.confidenceLevel,
            weeksOfSupply: null,
          },
        ],
      });
      return withPlan(c, stubPlan, members);
    }

    let locationValidation: PrescribedActionPlan["affectedPopulation"]["locationValidation"];
    if (isSegment && c.detail.segmentType === "location") {
      const key = String(c.detail.segmentKey ?? "");
      if (!isValidLocationCode(key)) {
        locationValidation = {
          status: "invalid_or_unknown",
          rawValue: key,
          message: locationValidationMessage(key),
        };
      } else {
        locationValidation = {
          status: "valid",
          rawValue: key,
          message: locationValidationMessage(key),
        };
      }
    } else if (isSegment && c.detail.segmentType === "company") {
      locationValidation = {
        status: "invalid_or_unknown",
        rawValue: String(c.detail.segmentKey ?? "unmapped_location"),
        message:
          "Priority presented at company/portfolio level because location codes were missing, defaulted (e.g. \"0\"), or failed validation.",
      };
    } else if (!isSegment) {
      const loc = members[0]?.locationCode;
      if (loc && !isValidLocationCode(loc)) {
        locationValidation = {
          status: "invalid_or_unknown",
          rawValue: loc,
          message: locationValidationMessage(loc),
        };
      } else if (loc) {
        locationValidation = { status: "valid", rawValue: loc };
      } else {
        locationValidation = { status: "not_applicable" };
      }
    } else {
      locationValidation = { status: "not_applicable" };
    }

    const plan = buildPrescribedActionPlan({
      analysisGrain: isSegment ? "segment" : "sku",
      actionType: c.actionType,
      segmentType: isSegment ? String(c.detail.segmentType ?? "") : null,
      segmentKey: isSegment ? String(c.detail.segmentKey ?? "") : null,
      members,
      locationValidation,
    });

    return withPlan(c, plan, members);
  });
}

function withPlan(
  c: ScoredCandidate,
  plan: PrescribedActionPlan,
  members: SkuActionInput[]
): ScoredCandidate {
  const isSegment = c.detail?.analysisGrain === "segment";
  const prescriptions = members.map(prescribeSkuAction);
  const prescriptionBySku = new Map(prescriptions.map((p) => [p.skuOrItemId, p]));

  const memberSkus = (
    (c.detail.memberSkus as
      | {
          skuOrItemId: string;
          description?: string | null;
          inventoryValue?: number | null;
          weeksOfSupply?: number | null;
          recommendedAction?: string;
        }[]
      | undefined) ??
    members.map((m) => ({
      skuOrItemId: m.skuOrItemId,
      description: m.description ?? null,
      inventoryValue: m.inventoryValue,
      weeksOfSupply: m.weeksOfSupply,
      recommendedAction: undefined as string | undefined,
    }))
  ).map((m) => {
    const p = prescriptionBySku.get(m.skuOrItemId);
    return {
      ...m,
      recommendedAction: p?.actionLabel ?? m.recommendedAction ?? "Management review",
      prescribedActionCode: p?.actionCode ?? null,
      prescribedActionReason: p?.reason ?? null,
    };
  });

  let candidateTitle = c.candidateTitle;
  if (
    c.actionType === "Trapped Cash Review" ||
    c.actionType.includes("Replenishment")
  ) {
    const value = c.estimatedCashImpact;
    if (isSegment) {
      candidateTitle = `Reduce ${usd(value)} of trapped cash across ${plan.affectedPopulation.skuCount} excess SKUs`;
      if (c.detail.segmentType === "company") {
        candidateTitle += ` (company level — location unmapped)`;
      } else if (c.detail.segmentType && c.detail.segmentKey) {
        candidateTitle += ` · ${String(c.detail.segmentType)} "${String(c.detail.segmentKey)}"`;
      }
    } else if (members[0]) {
      const p = prescriptionBySku.get(members[0].skuOrItemId);
      candidateTitle = p
        ? `${p.actionLabel} — ${members[0].skuOrItemId} (${usd(value)})`
        : c.candidateTitle;
    }
  }

  return {
    ...c,
    candidateTitle,
    detail: {
      ...c.detail,
      memberSkus,
      prescribedActionPlan: plan,
      recommendedManagementAction: plan.recommendedManagementAction,
      dataQualityWarning:
        plan.affectedPopulation.locationValidation?.status === "invalid_or_unknown"
          ? plan.affectedPopulation.locationValidation.message
          : null,
    },
  };
}
