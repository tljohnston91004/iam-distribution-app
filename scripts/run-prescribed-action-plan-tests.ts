/**
 * Prescribed Action Plan + location validation (V1.5 product completeness).
 */
import {
  attachPrescribedActionPlans,
  buildPrescribedActionPlan,
  isValidLocationCode,
  prescribeSkuAction,
  type SkuActionInput,
} from "../src/lib/iam/actions";
import { identifySegmentCandidates } from "../src/lib/iam/engine/segments";
import { buildSkuEvidence } from "../src/lib/iam/engine/ranking";

type Result = { id: string; name: string; pass: boolean; detail: string };

function assert(id: string, name: string, pass: boolean, detail: string): Result {
  return { id, name, pass, detail };
}

function baseEv(overrides: Partial<SkuActionInput> & { skuOrItemId: string }): SkuActionInput {
  const { skuOrItemId, ...rest } = overrides;
  return {
    skuOrItemId,
    quantityOnHand: 1000,
    cost: 50,
    inventoryValue: 50_000,
    unitsSold: 5,
    grossSalesDollars: 400,
    backorderQuantity: null,
    openOrderQuantity: 0,
    dataConfidence: "Medium Confidence",
    weeksOfSupply: 80,
    classification: "D",
    vendorName: "VendorA",
    locationCode: "WH1",
    lastSoldDate: new Date(Date.now() - 400 * 86400000),
    ...rest,
  };
}

async function main() {
  const results: Result[] = [];

  results.push(
    assert(
      "LOC-0-INVALID",
      'Location "0" is not a valid customer location',
      !isValidLocationCode("0") && !isValidLocationCode("00") && !isValidLocationCode(""),
      `0=${isValidLocationCode("0")} blank=${isValidLocationCode("")}`
    )
  );
  results.push(
    assert(
      "LOC-VALID",
      "Real location codes validate",
      isValidLocationCode("WH1") && isValidLocationCode("DC-EAST"),
      "WH1 / DC-EAST"
    )
  );

  // No location-level segment for "0"
  const loc0Members = Array.from({ length: 5 }, (_, i) =>
    buildSkuEvidence(
      `L0-${i}`,
      {
        quantityOnHand: 800,
        cost: 100,
        inventoryValue: 80_000,
        dataConfidence: "Medium Confidence",
        classification: "D",
        locationCode: "0",
      },
      { unitsSold: 8, grossSalesDollars: 600, dataConfidence: "Medium Confidence" }
    )
  );
  const segs = identifySegmentCandidates(loc0Members);
  const locSegs = segs.filter((s) => s.detail.segmentType === "location");
  const companySegs = segs.filter((s) => s.detail.segmentType === "company");
  results.push(
    assert(
      "LOC-0-NO-LOCATION-SEG",
      'Location "0" does not create a location-level Recommendation',
      locSegs.length === 0,
      `locationSegs=${locSegs.length}`
    )
  );
  results.push(
    assert(
      "LOC-0-COMPANY-SEG",
      "Invalid locations roll up to company-level priority with warning",
      companySegs.length === 1 &&
        Boolean(companySegs[0]?.detail.dataQualityWarning) &&
        companySegs[0]?.detail.segmentKey === "unmapped_location",
      JSON.stringify(companySegs[0]?.detail?.segmentKey)
    )
  );

  // Different SKUs get different prescriptions
  const deepAged = prescribeSkuAction(
    baseEv({
      skuOrItemId: "DEEP",
      weeksOfSupply: 60,
      classification: "D",
      lastSoldDate: new Date(Date.now() - 400 * 86400000),
      vendorName: null,
      unitsSold: 0,
    })
  );
  const withPo = prescribeSkuAction(
    baseEv({
      skuOrItemId: "PO1",
      weeksOfSupply: 40,
      openPurchaseOrders: 50,
      unitsSold: 20,
      lastSoldDate: new Date(),
      classification: "B",
    })
  );
  const minMax = prescribeSkuAction(
    baseEv({
      skuOrItemId: "MM1",
      weeksOfSupply: 30,
      rseMinMaxIssue: true,
      unitsSold: 40,
    })
  );
  const incomplete = prescribeSkuAction(
    baseEv({
      skuOrItemId: "GAP",
      quantityOnHand: null,
      inventoryValue: null,
      cost: null,
    })
  );

  results.push(
    assert(
      "PAP-DIFF-ACTIONS",
      "SKU prescriptions are not one generic action",
      new Set([deepAged.actionCode, withPo.actionCode, minMax.actionCode]).size >= 3,
      `${deepAged.actionCode} / ${withPo.actionCode} / ${minMax.actionCode}`
    )
  );
  results.push(
    assert(
      "PAP-DATA-GAP",
      "Incomplete evidence → data correction / review, not unsupported disposition",
      incomplete.actionCode === "data_correction_review",
      incomplete.actionCode
    )
  );

  const plan = buildPrescribedActionPlan({
    analysisGrain: "segment",
    actionType: "Trapped Cash Review",
    segmentType: "classification",
    segmentKey: "D",
    members: [
      baseEv({ skuOrItemId: "A1", weeksOfSupply: 60, openPurchaseOrders: 10, unitsSold: 15 }),
      baseEv({
        skuOrItemId: "A2",
        weeksOfSupply: 70,
        vendorName: "V1",
        lastSoldDate: new Date(Date.now() - 400 * 86400000),
        unitsSold: 2,
      }),
      baseEv({ skuOrItemId: "A3", weeksOfSupply: 55, rseMinMaxIssue: true }),
      baseEv({
        skuOrItemId: "A4",
        weeksOfSupply: 90,
        classification: "D",
        lastSoldDate: new Date(Date.now() - 400 * 86400000),
        unitsSold: 0,
        vendorName: null,
      }),
    ],
  });

  const requiredFields = [
    "recommendedManagementAction",
    "reasonSelected",
    "immediateNextSteps",
    "affectedPopulation",
    "actionGroups",
    "executionSequence",
    "ownerRole",
    "targetCompletionPeriod",
    "expectedFinancialResult",
    "expectedOperationalResult",
    "successMeasures",
    "risksAndCautions",
    "dataGapsOrDecisionsRequired",
    "alternativeActions",
  ] as const;

  results.push(
    assert(
      "PAP-REQUIRED-FIELDS",
      "Prescribed Action Plan includes all required management fields",
      requiredFields.every((f) => plan[f] != null && (Array.isArray(plan[f]) ? (plan[f] as unknown[]).length > 0 || f === "dataGapsOrDecisionsRequired" || f === "alternativeActions" : true)),
      `groups=${plan.actionGroups.length} action=${plan.recommendedManagementAction.slice(0, 80)}`
    )
  );
  results.push(
    assert(
      "PAP-MULTI-GROUPS",
      "Segment plan groups SKUs into multiple action buckets when evidence differs",
      plan.actionGroups.length >= 2,
      plan.actionGroups.map((g) => `${g.actionLabel}:${g.skuCount}`).join(", ")
    )
  );
  results.push(
    assert(
      "PAP-90-DAY",
      "Segment program targets a completion period",
      plan.targetCompletionPeriod.toLowerCase().includes("90") ||
        plan.targetCompletionPeriod.toLowerCase().includes("day"),
      plan.targetCompletionPeriod
    )
  );

  // attachPrescribedActionPlans on company segment
  const evidenceBySku = new Map<string, SkuActionInput>();
  for (const m of loc0Members) {
    evidenceBySku.set(m.skuOrItemId, { ...m, lastSoldDate: new Date(Date.now() - 200 * 86400000) });
  }
  const enriched = attachPrescribedActionPlans(companySegs, evidenceBySku);
  const attached = enriched[0]?.detail?.prescribedActionPlan as { version?: string; actionGroups?: unknown[] } | undefined;
  results.push(
    assert(
      "PAP-ATTACH",
      "attachPrescribedActionPlans writes plan onto segment candidate",
      Boolean(attached?.version === "iam_v15_prescribed_action_plan_v1" && (attached.actionGroups?.length ?? 0) > 0),
      JSON.stringify({ version: attached?.version, groups: attached?.actionGroups?.length })
    )
  );
  results.push(
    assert(
      "PAP-TITLE",
      "Segment title is action-oriented (Reduce $… across N SKUs)",
      /Reduce \$[\d,]+ of trapped cash across \d+ excess SKUs/i.test(enriched[0]?.candidateTitle ?? ""),
      enriched[0]?.candidateTitle ?? ""
    )
  );

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} — ${r.name}: ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
