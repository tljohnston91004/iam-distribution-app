/**
 * Phase 3 Closure tests (DF-01, DF-02, DF-03).
 * Run: npx tsx scripts/run-phase3-closure-tests.ts
 */
import { prisma, ensureDefaultCompany } from "../src/lib/db";
import {
  LS,
  presentForReview,
  approveRecommendation,
  assignPrimaryOwner,
  acceptAssignment,
  pauseRecommendation,
  escalateRecommendation,
  transitionRecommendation,
  LifecycleTransitionError,
} from "../src/lib/iam/lifecycle";

type Result = { id: string; name: string; pass: boolean; detail: string };

async function makeRec(iamRunId: string, title: string) {
  return prisma.recommendation.create({
    data: {
      iamRunId,
      sourceModule: "RSE",
      sourceRecommendationId: `CL-${Math.random().toString(36).slice(2, 10)}`,
      generationPath: "module",
      opportunityKey: `SKU-CL|${title}`,
      skuOrItemId: "SKU-CL",
      recommendationType: "Trapped Cash Review",
      title,
      lifecycleState: LS.LS_01,
      presentationCategory: "managed_backlog",
    },
  });
}

async function toActive(recId: string) {
  await presentForReview(recId);
  await approveRecommendation(recId);
  await assignPrimaryOwner(recId, { primaryOwnerUserId: "owner-cl" });
  await acceptAssignment(recId, { ownerUserId: "owner-cl" });
}

async function main() {
  const results: Result[] = [];
  const company = await ensureDefaultCompany();
  const run = await prisma.iamRun.create({
    data: {
      companyId: company.id,
      runName: "Phase3 Closure Test Run",
      reviewDate: new Date(),
      reviewWeekStart: new Date(),
      reviewWeekEnd: new Date(),
      cycleStatus: "Open",
    },
  });

  try {
    // DF-02: failed pause from Identified leaves no Pause governance and no LS change
    const r1 = await makeRec(run.id, "Pause Fail");
    const govBefore = await prisma.governanceDecision.count({
      where: { recommendationId: r1.id, decisionType: "Pause" },
    });
    try {
      await pauseRecommendation(r1.id, { reason: "x", approvedBy: "exec" });
      results.push({ id: "P3C-DF02-PAUSE", name: "Failed pause leaves no governance", pass: false, detail: "expected throw" });
    } catch (e) {
      const govAfter = await prisma.governanceDecision.count({
        where: { recommendationId: r1.id, decisionType: "Pause" },
      });
      const rec = await prisma.recommendation.findUnique({ where: { id: r1.id } });
      results.push({
        id: "P3C-DF02-PAUSE",
        name: "Failed pause leaves no Pause governance and no LS change",
        pass:
          e instanceof LifecycleTransitionError &&
          govAfter === govBefore &&
          rec?.lifecycleState === "Identified",
        detail: `ls=${rec?.lifecycleState} pauseGov=${govAfter} err=${e instanceof Error ? e.message : e}`,
      });
    }

    // DF-02: failed escalate similarly
    const r2 = await makeRec(run.id, "Esc Fail");
    try {
      await escalateRecommendation(r2.id, { reason: "need help" });
      results.push({ id: "P3C-DF02-ESC", name: "Failed escalate leaves no governance", pass: false, detail: "expected throw" });
    } catch (e) {
      const escGov = await prisma.governanceDecision.count({
        where: { recommendationId: r2.id, decisionType: "Escalate" },
      });
      const rec = await prisma.recommendation.findUnique({ where: { id: r2.id } });
      results.push({
        id: "P3C-DF02-ESC",
        name: "Failed escalate leaves no Escalate governance and no LS change",
        pass: escGov === 0 && rec?.lifecycleState === "Identified" && e instanceof LifecycleTransitionError,
        detail: `ls=${rec?.lifecycleState} escGov=${escGov}`,
      });
    }

    // Successful pause is atomic: LS + Pause governance together
    const r3 = await makeRec(run.id, "Pause OK");
    await toActive(r3.id);
    await pauseRecommendation(r3.id, { reason: "waiting", approvedBy: "exec-1", performedBy: "mgr" });
    const r3After = await prisma.recommendation.findUnique({ where: { id: r3.id } });
    const pauseGov = await prisma.governanceDecision.findFirst({
      where: { recommendationId: r3.id, decisionType: "Pause" },
    });
    results.push({
      id: "P3C-DF02-OK",
      name: "Successful pause commits LS + governance together",
      pass: r3After?.lifecycleState === "Paused" && Boolean(pauseGov),
      detail: `ls=${r3After?.lifecycleState} gov=${pauseGov?.decisionType}`,
    });

    // DF-03: all moves go through engine validation (illegal Identified→Active)
    const r4 = await makeRec(run.id, "Engine");
    try {
      await transitionRecommendation({ recommendationId: r4.id, toState: "Active", performedBy: "tester" });
      results.push({ id: "P3C-DF03", name: "Engine rejects illegal transition", pass: false, detail: "expected throw" });
    } catch (e) {
      const rec = await prisma.recommendation.findUnique({ where: { id: r4.id } });
      results.push({
        id: "P3C-DF03",
        name: "All transitions validated through lifecycle engine",
        pass: e instanceof LifecycleTransitionError && rec?.lifecycleState === "Identified",
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    // DF-01: rejected attempt audited
    const rejects = await prisma.auditEvent.findMany({
      where: { entityId: r4.id, action: "lifecycle:rejected" },
    });
    const detail = rejects[0]?.detailJson ? JSON.parse(rejects[0].detailJson) : null;
    results.push({
      id: "P3C-DF01",
      name: "Illegal transitions generate audit records",
      pass:
        rejects.length >= 1 &&
        detail?.requestingUser === "tester" &&
        typeof detail?.rejectionReason === "string" &&
        typeof detail?.timestamp === "string" &&
        String(detail?.requestedTransition ?? "").includes("Active"),
      detail: JSON.stringify(detail),
    });

    // Failed pause also audited
    const pauseRejects = await prisma.auditEvent.findMany({
      where: { entityId: r1.id, action: "lifecycle:rejected" },
    });
    results.push({
      id: "P3C-DF01-PAUSE",
      name: "Failed pause generates rejection audit",
      pass: pauseRejects.length >= 1,
      detail: `count=${pauseRejects.length}`,
    });

    // Named pause from wrong state: no partial LS
    const r5 = await makeRec(run.id, "Partial");
    await presentForReview(r5.id);
    const lsBefore = (await prisma.recommendation.findUnique({ where: { id: r5.id } }))!.lifecycleState;
    try {
      await pauseRecommendation(r5.id, { reason: "nope", approvedBy: "e" });
    } catch {
      /* expected */
    }
    const lsAfter = (await prisma.recommendation.findUnique({ where: { id: r5.id } }))!.lifecycleState;
    const wf = await prisma.workflowEvent.count({ where: { recommendationId: r5.id } });
    // present_for_review created 1 workflow event; pause must not add another
    results.push({
      id: "P3C-NO-PARTIAL",
      name: "Failed transitions leave no partial lifecycle changes",
      pass: lsAfter === lsBefore && lsAfter === "Management Review" && wf === 1,
      detail: `ls=${lsAfter} wf=${wf}`,
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
