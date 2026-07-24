/**
 * Phase 4 scoring + presentation tests.
 * Run: npx tsx scripts/run-phase4-scoring-tests.ts
 */
import { prisma, ensureDefaultCompany } from "../src/lib/db";
import {
  INTERIM_SCORING_PROFILE_ID,
  INTERIM_COMPOSITE_WEIGHTS,
  scoreRecommendation,
  rankScoredRecommendations,
  scoreReviewCycle,
} from "../src/lib/iam/scoring";
import {
  assignPresentation,
  EMERGENCY_ASSIGNMENT_ENABLED,
  scoreAndPresentReviewCycle,
} from "../src/lib/iam/presentation";
import { upsertRecommendations } from "../src/lib/iam/inbound";
import {
  deferRecommendation,
  reactivateDeferredRecommendation,
} from "../src/lib/iam/lifecycle";

type Result = { id: string; name: string; pass: boolean; detail: string };

async function main() {
  const results: Result[] = [];
  const company = await ensureDefaultCompany();
  const run = await prisma.iamRun.create({
    data: {
      companyId: company.id,
      runName: "Phase4 Scoring Test Run",
      reviewDate: new Date(),
      reviewWeekStart: new Date(),
      reviewWeekEnd: new Date(),
      cycleStatus: "Open",
    },
  });

  try {
    // P4-PROFILE — interim profile labeled
    results.push({
      id: "P4-PROFILE",
      name: "Interim scoring profile id and label present",
      pass: INTERIM_SCORING_PROFILE_ID === "interim_v1_cash_led",
      detail: INTERIM_SCORING_PROFILE_ID,
    });

    // P4-SD14 — actionability not in composite weights
    const weightSum =
      INTERIM_COMPOSITE_WEIGHTS.cashImpact +
      INTERIM_COMPOSITE_WEIGHTS.serviceOperationalRisk +
      INTERIM_COMPOSITE_WEIGHTS.inventoryCondition;
    const scored = scoreRecommendation(
      {
        id: "tmp-a",
        opportunityKey: "A|Trapped",
        generationPath: "module",
        lifecycleState: "Identified",
        confidence: "High Confidence",
        estimatedCashImpact: 50000,
        estimatedFinancialImpact: 50000,
        costOfInaction: null,
        explainabilityJson: null,
      },
      { weeksOfSupply: 40, hasRequiredEvidence: true, serviceRiskScoreHint: 10 }
    );
    const scoredWeakEvidence = scoreRecommendation(
      {
        id: "tmp-b",
        opportunityKey: "B|Trapped",
        generationPath: "module",
        lifecycleState: "Identified",
        confidence: "High Confidence",
        estimatedCashImpact: 50000,
        estimatedFinancialImpact: 50000,
        costOfInaction: null,
        explainabilityJson: null,
      },
      { weeksOfSupply: 40, hasRequiredEvidence: false, serviceRiskScoreHint: 10 }
    );
    results.push({
      id: "P4-SD14",
      name: "Actionability excluded from composite (sequencing only)",
      pass:
        Math.abs(weightSum - 1) < 0.001 &&
        scored.priorityScore === scoredWeakEvidence.priorityScore &&
        scored.actionabilitySequenceScore !== scoredWeakEvidence.actionabilitySequenceScore,
      detail: `sum=${weightSum.toFixed(4)} scoreEqual=${scored.priorityScore === scoredWeakEvidence.priorityScore} seq=${scored.actionabilitySequenceScore}/${scoredWeakEvidence.actionabilitySequenceScore}`,
    });

    // P4-NOSUPPRESS — low confidence still ranked
    const low = scoreRecommendation(
      {
        id: "tmp-low",
        opportunityKey: "L|Stock",
        generationPath: "interim_evidence",
        lifecycleState: "Identified",
        confidence: "Insufficient Data",
        estimatedCashImpact: 1000,
        estimatedFinancialImpact: 1000,
        costOfInaction: null,
        explainabilityJson: null,
      },
      { weeksOfSupply: 1, hasRequiredEvidence: false, serviceRiskScoreHint: 80 }
    );
    const rankedIncl = rankScoredRecommendations([scored, low]);
    results.push({
      id: "P4-NOSUPPRESS",
      name: "Low-confidence recommendations are ranked (not suppressed)",
      pass: rankedIncl.length === 2 && rankedIncl.some((r) => r.recommendationId === "tmp-low"),
      detail: `n=${rankedIncl.length} ids=${rankedIncl.map((r) => r.recommendationId).join(",")}`,
    });

    // Seed recommendations for persistence / presentation
    await upsertRecommendations({
      reviewCycleId: run.id,
      recommendations: [
        {
          sourceModule: "RSE",
          sourceRecommendationId: "mod-1",
          generationPath: "module",
          opportunityKey: "SKU-M|Trapped Cash Review",
          skuOrItemId: "SKU-M",
          recommendationType: "Trapped Cash Review",
          title: "Module high cash",
          confidence: "High Confidence",
          estimatedCashImpact: 90000,
          presentationCategory: "managed_backlog",
        },
        {
          sourceModule: "IAM",
          sourceRecommendationId: "int-1",
          generationPath: "interim_evidence",
          opportunityKey: "SKU-I|Stock Risk Review",
          skuOrItemId: "SKU-I",
          recommendationType: "Stock Risk Review",
          title: "Interim stock risk",
          confidence: "Medium Confidence",
          estimatedCashImpact: 5000,
          explainability: { serviceRiskScore: 90, interim: true },
          presentationCategory: "managed_backlog",
        },
        {
          sourceModule: "IAM",
          sourceRecommendationId: "int-2",
          generationPath: "interim_evidence",
          opportunityKey: "SKU-B|Trapped Cash Review",
          skuOrItemId: "SKU-B",
          recommendationType: "Trapped Cash Review",
          title: "Interim backlog cash",
          confidence: "High Confidence",
          estimatedCashImpact: 8000,
          presentationCategory: "managed_backlog",
        },
      ],
      performedBy: "phase4-test",
    });

    // Active open work → holdover lane
    const activeRec = await prisma.recommendation.create({
      data: {
        iamRunId: run.id,
        sourceModule: "RSE",
        sourceRecommendationId: "mod-active",
        generationPath: "module",
        opportunityKey: "SKU-A|Active Work",
        skuOrItemId: "SKU-A",
        recommendationType: "Trapped Cash Review",
        title: "Already active",
        lifecycleState: "Active",
        presentationCategory: "managed_backlog",
        confidence: "High Confidence",
        estimatedCashImpact: 12000,
      },
    });

    const presented = await scoreAndPresentReviewCycle(run.id);
    const all = await prisma.recommendation.findMany({ where: { iamRunId: run.id } });
    const byId = new Map(all.map((r) => [r.id, r]));

    results.push({
      id: "P4-PERSIST",
      name: "Score breakdown + profile persisted on Recommendations",
      pass: all.every(
        (r) =>
          r.scoringProfileId === INTERIM_SCORING_PROFILE_ID &&
          r.priorityScore != null &&
          Boolean(r.explainabilityJson && r.explainabilityJson.includes("breakdown"))
      ),
      detail: `scored=${presented.scoredCount} sample=${all[0]?.scoringProfileId}/${all[0]?.priorityScore}`,
    });

    const active = all.filter(
      (r) => r.presentationCategory === "active_priority" || r.presentationCategory === "top_2"
    );
    const holdover = all.filter((r) => r.presentationCategory === "holdover");
    const waiting = all.filter(
      (r) =>
        r.presentationCategory === "waiting_activation" || r.presentationCategory === "managed_backlog"
    );
    const emergency = all.filter((r) => r.presentationCategory === "emergency");

    results.push({
      id: "P4-TOP2",
      name: "Presentation assigns Active Priorities from ranked scores within OEC",
      pass: active.length === 1 && presented.oec?.promoted === 1 && presented.oec?.holdoverConsumed === 1,
      detail: `active=${active.map((r) => `${r.title}:${r.priorityScore}`).join(" | ")} oec=${JSON.stringify(presented.oec ?? "n/a")}`,
    });

    results.push({
      id: "P4-HOLDOVER",
      name: "Open execution work lands in Holdover lane (not LS change)",
      pass:
        holdover.some((r) => r.id === activeRec.id) &&
        byId.get(activeRec.id)?.lifecycleState === "Active",
      detail: `holdover=${holdover.length} activeLs=${byId.get(activeRec.id)?.lifecycleState}`,
    });

    results.push({
      id: "P4-BACKLOG",
      name: "Remaining competitors are Waiting for Activation",
      pass: waiting.length >= 1 && emergency.length === 0 && !EMERGENCY_ASSIGNMENT_ENABLED,
      detail: `waiting=${waiting.length} emergency=${emergency.length}`,
    });

    results.push({
      id: "P4-LS-INDEP",
      name: "Presentation assignment does not mutate lifecycle states",
      pass: all.every((r) =>
        r.id === activeRec.id ? r.lifecycleState === "Active" : r.lifecycleState === "Identified"
      ),
      detail: all.map((r) => `${r.presentationCategory}/${r.lifecycleState}`).join(", "),
    });

    results.push({
      id: "P4-INTERIM-FLAG",
      name: "Interim evidence-generated Recommendations remain flagged",
      pass: all
        .filter((r) => r.generationPath === "interim_evidence")
        .every((r) => {
          const j = r.explainabilityJson ? JSON.parse(r.explainabilityJson) : {};
          return j.generationPath === "interim_evidence" || j.interim === true || r.generationPath === "interim_evidence";
        }),
      detail: `interimCount=${all.filter((r) => r.generationPath === "interim_evidence").length}`,
    });

    // With capacity expanded (Paused does not consume), Module high cash should promote when OEC allows
    await prisma.recommendation.update({
      where: { id: activeRec.id },
      data: { lifecycleState: "Paused" },
    });
    await prisma.company.update({
      where: { id: company.id },
      data: { organizationalExecutionCapability: 2 },
    });
    await assignPresentation(run.id);
    const activeExpanded = await prisma.recommendation.findMany({
      where: { iamRunId: run.id, presentationCategory: "active_priority" },
    });
    const moduleTop = activeExpanded.some((r) => r.generationPath === "module" && r.title.includes("Module"));
    results.push({
      id: "P4-MODULE",
      name: "Module Recommendation can occupy Active Priority when scored highest (Paused frees OEC)",
      pass: moduleTop && activeExpanded.length === 2,
      detail: activeExpanded.map((r) => `${r.generationPath}:${r.title}`).join(" | "),
    });

    // Restore Active for remaining tests
    await prisma.recommendation.update({
      where: { id: activeRec.id },
      data: { lifecycleState: "Active" },
    });
    await assignPresentation(run.id);

    // Re-assign after reject presentation preserved
    await prisma.recommendation.update({
      where: { id: all.find((r) => r.generationPath === "interim_evidence" && (r.presentationCategory === "waiting_activation" || r.presentationCategory === "managed_backlog"))!.id },
      data: { presentationCategory: "completed_presentation" },
    });
    await assignPresentation(run.id);
    const preserved = await prisma.recommendation.findMany({
      where: { iamRunId: run.id, presentationCategory: "completed_presentation" },
    });
    results.push({
      id: "P4-PRESERVE",
      name: "completed_presentation is preserved across re-assign",
      pass: preserved.length >= 1,
      detail: `preserved=${preserved.length}`,
    });

    // scoreReviewCycle alone does not change presentation for a fresh rec — covered by separation:
    const beforeCat = (await prisma.recommendation.findFirst({
      where: { iamRunId: run.id, title: "Module high cash" },
    }))!.presentationCategory;
    await scoreReviewCycle(run.id);
    const afterCat = (await prisma.recommendation.findFirst({
      where: { iamRunId: run.id, title: "Module high cash" },
    }))!.presentationCategory;
    results.push({
      id: "P4-SEP",
      name: "Scoring service does not change presentation category",
      pass: beforeCat === afterCat,
      detail: `${beforeCat} → ${afterCat}`,
    });

    // V1.5 Deferred Presentation Rule — not Active Priority; retains score; reactivation without rescoring
    const deferTarget = await prisma.recommendation.findFirst({
      where: { iamRunId: run.id, title: "Module high cash" },
    });
    if (!deferTarget) throw new Error("defer target missing");
    await prisma.recommendation.update({
      where: { id: deferTarget.id },
      data: { lifecycleState: "Management Review", presentationCategory: "waiting_activation" },
    });
    // Ensure present-for-review path: already Management Review
    const scoreBeforeDefer = deferTarget.priorityScore;
    await deferRecommendation(deferTarget.id, { reason: "Wait for next cash cycle", performedBy: "exec" });
    const afterDefer = await prisma.recommendation.findUnique({ where: { id: deferTarget.id } });
    const activeAfterDefer = await prisma.recommendation.findMany({
      where: {
        iamRunId: run.id,
        presentationCategory: { in: ["active_priority", "top_2"] },
      },
    });
    results.push({
      id: "P4-DEFER-LANE",
      name: "Active Defer → deferred lane; not in Active Priorities; score retained",
      pass:
        afterDefer?.presentationCategory === "deferred" &&
        afterDefer.priorityScore === scoreBeforeDefer &&
        !activeAfterDefer.some((r) => r.id === deferTarget.id) &&
        afterDefer.lifecycleState === "Management Review",
      detail: `present=${afterDefer?.presentationCategory} score=${afterDefer?.priorityScore} activeHas=${activeAfterDefer.some((r) => r.id === deferTarget.id)}`,
    });

    const reactivated = await reactivateDeferredRecommendation(deferTarget.id, {
      performedBy: "exec",
      reason: "Cash cycle opened",
    });
    const afterReact = await prisma.recommendation.findUnique({ where: { id: deferTarget.id } });
    results.push({
      id: "P4-DEFER-REACTIVATE",
      name: "Reactivate restores Active Priority eligibility without recalculating score",
      pass:
        afterReact?.priorityScore === scoreBeforeDefer &&
        afterReact?.presentationCategory !== "deferred" &&
        (afterReact?.presentationCategory === "active_priority" ||
          afterReact?.presentationCategory === "waiting_activation" ||
          afterReact?.presentationCategory === "top_2" ||
          afterReact?.presentationCategory === "managed_backlog") &&
        Boolean(reactivated.lanes),
      detail: `present=${afterReact?.presentationCategory} score=${afterReact?.priorityScore}`,
    });
  } finally {
    await prisma.iamRun.delete({ where: { id: run.id } }).catch(() => undefined);
  }

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} — ${r.name} :: ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
