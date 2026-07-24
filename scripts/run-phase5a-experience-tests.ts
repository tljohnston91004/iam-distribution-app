/**
 * Phase 5A / EEP experience tests — OEC, promotion, aging advisory, Trust story.
 * Run: npx tsx scripts/run-phase5a-experience-tests.ts
 */
import { prisma, ensureDefaultCompany } from "../src/lib/db";
import { upsertRecommendations } from "../src/lib/iam/inbound";
import {
  assignPresentation,
  evaluateAgingAdvisory,
  measureOecConsumption,
  scoreAndPresentReviewCycle,
  setCompanyOec,
  buildTrustStory,
  buildWeeklyBusinessSummary,
} from "../src/lib/iam/presentation";
import { loadBoardRecommendations } from "../src/lib/iam/board/load";

type Result = { id: string; name: string; pass: boolean; detail: string };

async function main() {
  const results: Result[] = [];
  const company = await ensureDefaultCompany();
  await prisma.company.update({
    where: { id: company.id },
    data: { organizationalExecutionCapability: 2, recommendationAgingDays: 14 },
  });

  const run = await prisma.iamRun.create({
    data: {
      companyId: company.id,
      runName: "Phase5A EEP Test Run",
      reviewDate: new Date(),
      reviewWeekStart: new Date(),
      reviewWeekEnd: new Date(),
      cycleStatus: "Open",
      readinessStatus: "Ready",
    },
  });

  try {
    await upsertRecommendations({
      reviewCycleId: run.id,
      recommendations: [
        {
          sourceModule: "RSE",
          sourceRecommendationId: "eep-1",
          generationPath: "module",
          opportunityKey: "SKU-E1|Trapped Cash Review",
          skuOrItemId: "SKU-E1",
          recommendationType: "Trapped Cash Review",
          title: "EEP High Cash",
          confidence: "High Confidence",
          estimatedCashImpact: 100000,
          presentationCategory: "managed_backlog",
        },
        {
          sourceModule: "RSE",
          sourceRecommendationId: "eep-2",
          generationPath: "module",
          opportunityKey: "SKU-E2|Trapped Cash Review",
          skuOrItemId: "SKU-E2",
          recommendationType: "Trapped Cash Review",
          title: "EEP Mid Cash",
          confidence: "Medium Confidence",
          estimatedCashImpact: 40000,
          presentationCategory: "managed_backlog",
        },
        {
          sourceModule: "IAM",
          sourceRecommendationId: "eep-3",
          generationPath: "interim_evidence",
          opportunityKey: "SKU-E3|Stock Risk Review",
          skuOrItemId: "SKU-E3",
          recommendationType: "Stock Risk Review",
          title: "EEP Waiting Candidate",
          confidence: "Medium Confidence",
          estimatedCashImpact: 10000,
          presentationCategory: "managed_backlog",
        },
      ],
      performedBy: "phase5a-test",
    });

    const paused = await prisma.recommendation.create({
      data: {
        iamRunId: run.id,
        sourceModule: "RSE",
        sourceRecommendationId: "eep-paused",
        generationPath: "module",
        opportunityKey: "SKU-P|Paused",
        recommendationType: "Trapped Cash Review",
        title: "EEP Paused Holdover",
        lifecycleState: "Paused",
        presentationCategory: "managed_backlog",
        confidence: "High Confidence",
        estimatedCashImpact: 50000,
      },
    });

    const activeHold = await prisma.recommendation.create({
      data: {
        iamRunId: run.id,
        sourceModule: "RSE",
        sourceRecommendationId: "eep-active",
        generationPath: "module",
        opportunityKey: "SKU-A|Active",
        recommendationType: "Trapped Cash Review",
        title: "EEP Active Holdover",
        lifecycleState: "Active",
        presentationCategory: "managed_backlog",
        confidence: "High Confidence",
        estimatedCashImpact: 60000,
      },
    });

    const presented = await scoreAndPresentReviewCycle(run.id);
    const all = await prisma.recommendation.findMany({ where: { iamRunId: run.id } });
    const activePri = all.filter((r) => r.presentationCategory === "active_priority");
    const waiting = all.filter((r) => r.presentationCategory === "waiting_activation");
    const holdover = all.filter((r) => r.presentationCategory === "holdover");

    results.push({
      id: "EEP-PROMOTE",
      name: "Active Priorities ≤ available OEC after Holdover consumption",
      pass:
        presented.oec.capacity === 2 &&
        presented.oec.holdoverConsumed === 1 &&
        presented.oec.promoted === 1 &&
        activePri.length === 1 &&
        waiting.length >= 1,
      detail: JSON.stringify(presented.oec),
    });

    results.push({
      id: "EEP-PAUSED-LANE",
      name: "Paused is Holdover-visible but excluded from OEC holdover consumption",
      pass:
        holdover.some((r) => r.id === paused.id) &&
        holdover.some((r) => r.id === activeHold.id) &&
        presented.oec.holdoverConsumed === 1,
      detail: `holdover=${holdover.map((r) => r.title).join("|")}`,
    });

    const consumption = await measureOecConsumption(run.id);
    results.push({
      id: "EEP-CONSUME",
      name: "measureOecConsumption excludes Paused; includes Active Priority + Active Holdover",
      pass:
        consumption.consumed === 2 &&
        !consumption.consumers.some((c) => c.recommendationId === paused.id) &&
        consumption.consumers.some((c) => c.recommendationId === activeHold.id),
      detail: JSON.stringify(consumption),
    });

    await setCompanyOec({
      companyId: company.id,
      organizationalExecutionCapability: 3,
      performedBy: "phase5a-test",
      iamRunId: run.id,
    });
    await assignPresentation(run.id);
    const afterOec = await prisma.recommendation.findMany({ where: { iamRunId: run.id } });
    const activeAfter = afterOec.filter((r) => r.presentationCategory === "active_priority");
    const audit = await prisma.auditEvent.findFirst({
      where: { iamRunId: run.id, action: "oec_config_updated" },
    });
    results.push({
      id: "EEP-OEC-AUDIT",
      name: "OEC config change is auditable and expands Active Priorities",
      pass: Boolean(audit) && activeAfter.length === 2,
      detail: `active=${activeAfter.length} audit=${Boolean(audit)}`,
    });

    const story = buildTrustStory({
      title: "EEP High Cash",
      recommendationType: "Trapped Cash Review",
      skuOrItemId: "SKU-E1",
      confidence: "High Confidence",
      estimatedCashImpact: 100000,
      estimatedFinancialImpact: null,
      costOfInaction: null,
      sourceModule: "RSE",
      generationPath: "module",
      priorityScore: 90,
    });
    results.push({
      id: "EEP-TRUST",
      name: "Trust Pyramid fields generated from existing facts",
      pass: Boolean(story.storyWhat && story.storyWhy && story.storyWhyNow && story.storyExpectedResult && story.confidenceNarrative),
      detail: story.storyWhat.slice(0, 80),
    });

    const board = await loadBoardRecommendations(run.id);
    const sample = board.find((r) => r.presentationCategory === "active_priority");
    results.push({
      id: "EEP-STORY-PERSIST",
      name: "Board loader exposes Trust Pyramid + confidence narrative",
      pass: Boolean(sample?.storyWhat && sample.confidenceNarrative),
      detail: sample?.storyWhat?.slice(0, 60) ?? "missing",
    });

    const agingNone = evaluateAgingAdvisory({
      recommendationId: "x",
      updatedAt: new Date(),
      thresholdDays: 14,
    });
    const agingYes = evaluateAgingAdvisory({
      recommendationId: "y",
      updatedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      thresholdDays: 14,
    });
    const beforeAging = await prisma.recommendation.findFirst({
      where: { iamRunId: run.id, title: "EEP High Cash" },
    });
    // Advisory only — no mutation when evaluating
    results.push({
      id: "EEP-AGING",
      name: "Aging is advisory only (prompt object; no auto-mutation)",
      pass: agingNone === null && agingYes?.advisory === true && beforeAging?.presentationCategory === "active_priority",
      detail: agingYes?.message.slice(0, 100) ?? "no aging",
    });

    const summary = buildWeeklyBusinessSummary({
      recommendationCount: board.length,
      dataGapCount: 0,
      readinessStatus: "Ready",
      recommendations: board,
      oec: 3,
      oecConsumed: 3,
    });
    results.push({
      id: "EEP-SUMMARY",
      name: "Weekly Business Summary derived from measurable facts",
      pass: Boolean(summary.headline && summary.bullets.length >= 3),
      detail: summary.headline,
    });

    // Progress update does not change lifecycle
    const target = afterOec.find((r) => r.lifecycleState === "Active")!;
    await prisma.recommendation.update({
      where: { id: target.id },
      data: {
        progressNarrative: "Working with buyer",
        blockerNote: "Waiting on vendor quote",
        lastProgressAt: new Date(),
      },
    });
    const afterProgress = await prisma.recommendation.findUnique({ where: { id: target.id } });
    results.push({
      id: "EEP-PROGRESS",
      name: "Progress fields are additive and do not change lifecycle",
      pass:
        afterProgress?.lifecycleState === "Active" &&
        afterProgress.progressNarrative === "Working with buyer" &&
        afterProgress.blockerNote === "Waiting on vendor quote",
      detail: afterProgress?.lifecycleState ?? "missing",
    });
  } finally {
    await prisma.iamRun.delete({ where: { id: run.id } }).catch(() => undefined);
    await prisma.company.update({
      where: { id: company.id },
      data: { organizationalExecutionCapability: 2 },
    });
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
