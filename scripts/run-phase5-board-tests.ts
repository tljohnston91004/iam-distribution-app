/**
 * Phase 5 Decision Board structure / API smoke tests.
 * Run: npx tsx scripts/run-phase5-board-tests.ts
 */
import { prisma, ensureDefaultCompany } from "../src/lib/db";
import { loadBoardRecommendations, loadBusinessHealth } from "../src/lib/iam/board/load";
import { LANE_ORDER, requiredActionHint } from "../src/lib/iam/board/types";
import { scoreAndPresentReviewCycle } from "../src/lib/iam/presentation";
import { presentForReview, deferRecommendation } from "../src/lib/iam/lifecycle";
import { upsertRecommendations } from "../src/lib/iam/inbound";

type Result = { id: string; name: string; pass: boolean; detail: string };

async function main() {
  const results: Result[] = [];
  const company = await ensureDefaultCompany();
  const run = await prisma.iamRun.create({
    data: {
      companyId: company.id,
      runName: "Phase5 Board Test Run",
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
          sourceRecommendationId: "p5-1",
          generationPath: "module",
          opportunityKey: "SKU-P5|Trapped Cash Review",
          skuOrItemId: "SKU-P5",
          recommendationType: "Trapped Cash Review",
          title: "Board Top Cash",
          confidence: "High Confidence",
          estimatedCashImpact: 80000,
          presentationCategory: "managed_backlog",
        },
        {
          sourceModule: "IAM",
          sourceRecommendationId: "p5-2",
          generationPath: "interim_evidence",
          opportunityKey: "SKU-P5B|Stock Risk Review",
          skuOrItemId: "SKU-P5B",
          recommendationType: "Stock Risk Review",
          title: "Board Interim Risk",
          confidence: "Medium Confidence",
          estimatedCashImpact: 12000,
          explainability: { serviceRiskScore: 80, interim: true },
          presentationCategory: "managed_backlog",
        },
      ],
      performedBy: "phase5-test",
    });

    await scoreAndPresentReviewCycle(run.id);
    const board = await loadBoardRecommendations(run.id);
    const health = await loadBusinessHealth(run.id);

    results.push({
      id: "P5-LOAD",
      name: "Board loader returns scored Recommendations",
      pass: board.length >= 2 && board.every((r) => r.priorityScore != null),
      detail: `n=${board.length}`,
    });

    results.push({
      id: "P5-LANES",
      name: "Lane order includes Active Priorities, Emergency, Holdover, Waiting, Deferred",
      pass:
        LANE_ORDER.join(",") ===
        "active_priority,emergency,holdover,waiting_activation,deferred",
      detail: LANE_ORDER.join("|"),
    });

    results.push({
      id: "P5-HEALTH",
      name: "Business health summary available",
      pass: Boolean(health && health.recommendationCount >= 2 && health.scoringProfileNote.includes("interim")),
      detail: JSON.stringify(health?.laneCounts),
    });

    const active = board.filter(
      (r) => r.presentationCategory === "active_priority" || r.presentationCategory === "top_2"
    );
    results.push({
      id: "P5-TOP2",
      name: "Active Priorities lane populated for Board",
      pass: active.length >= 1 && active.length <= 2,
      detail: active.map((r) => r.title).join(" | "),
    });

    const hint = requiredActionHint("Management Review", "waiting_activation");
    results.push({
      id: "P5-HINT",
      name: "Required action hints for management review",
      pass: hint.toLowerCase().includes("approve"),
      detail: hint,
    });

    const target = board.find((r) => r.title.includes("Cash"))!;
    await presentForReview(target.id);
    await deferRecommendation(target.id, { reason: "Wait for finance", performedBy: "exec" });
    const after = await loadBoardRecommendations(run.id);
    const deferred = after.find((r) => r.id === target.id);
    results.push({
      id: "P5-DEFER-UI",
      name: "Deferred recommendation appears in deferred lane for Board",
      pass: deferred?.presentationCategory === "deferred",
      detail: deferred?.presentationCategory ?? "missing",
    });

    const note = await prisma.recommendationNote.create({
      data: {
        recommendationId: target.id,
        body: "Finance wants next cycle",
        visibility: "management",
        authoredBy: "exec",
      },
    });
    const ownerNotes = await prisma.recommendationNote.findMany({
      where: { recommendationId: target.id, visibility: "shared" },
    });
    results.push({
      id: "P5-NOTES",
      name: "Management notes persist; distinct from shared",
      pass: Boolean(note.id) && ownerNotes.length === 0,
      detail: `note=${note.id} shared=${ownerNotes.length}`,
    });

    results.push({
      id: "P5-INTERIM-BADGE",
      name: "Interim generationPath available for Board badge",
      pass: after.some((r) => r.generationPath === "interim_evidence"),
      detail: after.map((r) => r.generationPath).join(","),
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
