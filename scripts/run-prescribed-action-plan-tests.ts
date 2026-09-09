/**
 * Prescribed Action Plan + location validation (V1.5 product completeness).
 */
import {
  attachPrescribedActionPlans,
  buildLocationCodeContext,
  buildPrescribedActionPlan,
  isSolePrimaryLocation,
  isValidLocationCode,
  locationValidationMessage,
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
      'Location "0" is not valid without sole-location context',
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

  const sole0 = buildLocationCodeContext(["0", "0", "0"]);
  results.push(
    assert(
      "LOC-0-SOLE-PRIMARY",
      'Location "0" is home/primary when it is the only location in the dataset',
      isValidLocationCode("0", sole0) &&
        isSolePrimaryLocation("0", sole0) &&
        locationValidationMessage("0", sole0).includes("home/primary"),
      locationValidationMessage("0", sole0)
    )
  );
  const mixedCtx = buildLocationCodeContext(["0", "WH1"]);
  results.push(
    assert(
      "LOC-0-MIXED-STILL-INVALID",
      'Location "0" stays invalid when other real locations exist',
      !isValidLocationCode("0", mixedCtx) && isValidLocationCode("WH1", mixedCtx),
      `0=${isValidLocationCode("0", mixedCtx)} WH1=${isValidLocationCode("WH1", mixedCtx)}`
    )
  );

  // Sole Location "0" → location-level home/primary segment (not company unmapped)
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
      "LOC-0-LOCATION-SEG-WHEN-SOLE",
      'Sole Location "0" creates a location-level Recommendation (home/primary)',
      locSegs.length === 1 && locSegs[0]?.detail.segmentKey === "0",
      `locationSegs=${locSegs.length} key=${locSegs[0]?.detail.segmentKey}`
    )
  );
  results.push(
    assert(
      "LOC-0-NO-COMPANY-SEG-WHEN-SOLE",
      "Sole Location 0 does not create company unmapped rollup",
      companySegs.length === 0,
      `companySegs=${companySegs.length}`
    )
  );

  // Mixed "0" + WH1 → "0" is not a location segment; company unmapped for "0" SKUs
  const mixedMembers = [
    ...Array.from({ length: 3 }, (_, i) =>
      buildSkuEvidence(
        `M0-${i}`,
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
    ),
    ...Array.from({ length: 3 }, (_, i) =>
      buildSkuEvidence(
        `MWH-${i}`,
        {
          quantityOnHand: 800,
          cost: 100,
          inventoryValue: 80_000,
          dataConfidence: "Medium Confidence",
          classification: "D",
          locationCode: "WH1",
        },
        { unitsSold: 8, grossSalesDollars: 600, dataConfidence: "Medium Confidence" }
      )
    ),
  ];
  const mixedSegs = identifySegmentCandidates(mixedMembers);
  const mixedLoc0 = mixedSegs.filter(
    (s) => s.detail.segmentType === "location" && s.detail.segmentKey === "0"
  );
  const mixedCompany = mixedSegs.filter((s) => s.detail.segmentType === "company");
  results.push(
    assert(
      "LOC-0-NO-LOCATION-SEG-WHEN-MIXED",
      'Location "0" does not create a location segment when other locations exist',
      mixedLoc0.length === 0,
      `loc0Segs=${mixedLoc0.length}`
    )
  );
  results.push(
    assert(
      "LOC-0-COMPANY-SEG-WHEN-MIXED",
      "Invalid 0 locations roll up to company-level when mixed with real locations",
      mixedCompany.length === 1 && mixedCompany[0]?.detail.segmentKey === "unmapped_location",
      JSON.stringify(mixedCompany[0]?.detail?.segmentKey)
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

  // attachPrescribedActionPlans on sole-0 location segment
  const evidenceBySku = new Map<string, SkuActionInput>();
  for (const m of loc0Members) {
    evidenceBySku.set(m.skuOrItemId, { ...m, lastSoldDate: new Date(Date.now() - 200 * 86400000) });
  }
  const enriched = attachPrescribedActionPlans(locSegs, evidenceBySku, sole0);
  const attached = enriched[0]?.detail?.prescribedActionPlan as {
    version?: string;
    actionGroups?: unknown[];
    affectedPopulation?: { locationValidation?: { status?: string; message?: string } };
  } | undefined;
  results.push(
    assert(
      "PAP-ATTACH",
      "attachPrescribedActionPlans writes plan onto location segment candidate",
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
  results.push(
    assert(
      "PAP-SOLE-0-VALID-MSG",
      "Sole primary location 0 shows accepted home/primary validation (not invalid warning)",
      attached?.affectedPopulation?.locationValidation?.status === "valid" &&
        (attached?.affectedPopulation?.locationValidation?.message ?? "").includes("home/primary") &&
        !enriched[0]?.detail?.dataQualityWarning,
      JSON.stringify(attached?.affectedPopulation?.locationValidation)
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
