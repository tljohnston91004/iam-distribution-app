/**
 * Attach required Prescribed Action Plans to scored candidates (SKU + segment).
 */

import {
  buildLocationCodeContext,
  buildPrescribedActionPlan,
  isValidLocationCode,
  locationDisplayLabel,
  locationValidationMessage,
  prescribeSkuAction,
  type LocationCodeContext,
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
  evidenceBySku: Map<string, SkuActionInput>,
  locationCtx?: LocationCodeContext | null
): ScoredCandidate[] {
  const ctx =
    locationCtx ??
    buildLocationCodeContext([...evidenceBySku.values()].map((e) => e.locationCode));

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
        locationCtx: ctx,
      });
      return withPlan(c, stubPlan, members, ctx);
    }

    let locationValidation: PrescribedActionPlan["affectedPopulation"]["locationValidation"];
    if (isSegment && c.detail.segmentType === "location") {
      const key = String(c.detail.segmentKey ?? "");
      if (!isValidLocationCode(key, ctx)) {
        locationValidation = {
          status: "invalid_or_unknown",
          rawValue: key,
          message: locationValidationMessage(key, ctx),
        };
      } else {
        locationValidation = {
          status: "valid",
          rawValue: key,
          message: locationValidationMessage(key, ctx),
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
      if (loc && !isValidLocationCode(loc, ctx)) {
        locationValidation = {
          status: "invalid_or_unknown",
          rawValue: loc,
          message: locationValidationMessage(loc, ctx),
        };
      } else if (loc) {
        locationValidation = {
          status: "valid",
          rawValue: loc,
          message: locationValidationMessage(loc, ctx),
        };
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
      locationCtx: ctx,
    });

    return withPlan(c, plan, members, ctx);
  });
}

function withPlan(
  c: ScoredCandidate,
  plan: PrescribedActionPlan,
  members: SkuActionInput[],
  locationCtx: LocationCodeContext
): ScoredCandidate {
  const prescriptionBySku = new Map(
    plan.actionGroups.flatMap((g) =>
      g.skus.map((s) => [
        s.skuOrItemId,
        { actionLabel: g.actionLabel, actionCode: g.actionCode, reason: s.reason },
      ])
    )
  );

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
      description: null as string | null,
      inventoryValue: m.inventoryValue,
      weeksOfSupply: m.weeksOfSupply,
      recommendedAction: undefined as string | undefined,
    }))
  )
    .map((m) => {
      const p = prescriptionBySku.get(m.skuOrItemId);
      return {
        ...m,
        recommendedAction: p?.actionLabel ?? m.recommendedAction ?? "Management review",
        prescribedActionCode: p?.actionCode ?? null,
        prescribedActionReason: p?.reason ?? null,
      };
    })
    .slice(0, 80);

  let candidateTitle = c.candidateTitle;
  if (
    c.actionType === "Trapped Cash Review" ||
    c.actionType.includes("Replenishment")
  ) {
    const value = c.estimatedCashImpact;
    if (c.detail?.analysisGrain === "segment") {
      candidateTitle = `Reduce ${usd(value)} of trapped cash across ${plan.affectedPopulation.skuCount} excess SKUs`;
      if (c.detail.segmentType === "company") {
        candidateTitle += ` (company level — location unmapped)`;
      } else if (c.detail.segmentType === "location" && c.detail.segmentKey) {
        const label = locationDisplayLabel(String(c.detail.segmentKey), locationCtx);
        candidateTitle += ` · location "${label}"`;
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
