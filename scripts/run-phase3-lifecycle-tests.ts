/**
 * Phase 3 lifecycle / governance tests — IAM-007B + clarifications.
 * Run: npx tsx scripts/run-phase3-lifecycle-tests.ts
 */
import { prisma, ensureDefaultCompany } from "../src/lib/db";
import {
  LS,
  LIFECYCLE_STATES,
  NON_LIFECYCLE_OUTCOMES,
  presentForReview,
  approveRecommendation,
  deferRecommendation,
  rejectRecommendation,
  assignPrimaryOwner,
  acceptAssignment,
  addContributor,
  pauseRecommendation,
  resumeRecommendation,
  escalateRecommendation,
  completeRecommendation,
  startOutcomeValidation,
  passOutcomeValidation,
  archiveRecommendation,
  transitionRecommendation,
  lockReviewCycle,
  LifecycleTransitionError,
} from "../src/lib/iam/lifecycle";

type Result = { id: string; name: string; pass: boolean; detail: string };

async function makeRec(iamRunId: string, title = "Phase3 Rec") {
  return prisma.recommendation.create({
    data: {
      iamRunId,
      sourceModule: "RSE",
      sourceRecommendationId: `SRC-${Math.random().toString(36).slice(2, 10)}`,
      generationPath: "module",
      opportunityKey: `SKU-P3|${title}`,
      skuOrItemId: "SKU-P3",
      recommendationType: "Trapped Cash Review",
      title,
      lifecycleState: LS.LS_01,
      presentationCategory: "managed_backlog",
    },
  });
}

async function main() {
  const results: Result[] = [];
  const company = await ensureDefaultCompany();
  const run = await prisma.iamRun.create({
    data: {
      companyId: company.id,
      runName: "Phase3 Lifecycle Test Run",
      reviewDate: new Date(),
      reviewWeekStart: new Date(),
      reviewWeekEnd: new Date(),
      runStatus: "Open",
      cycleStatus: "Open",
    },
  });

  try {
    results.push({
      id: "P3-LS-CATALOG",
      name: "LS-01–LS-11 catalog matches IAM-007B",
      pass:
        LIFECYCLE_STATES.length === 11 &&
        LIFECYCLE_STATES[0] === "Identified" &&
        LIFECYCLE_STATES[7] === "Escalated" &&
        LIFECYCLE_STATES[9] === "Outcome Validation" &&
        LIFECYCLE_STATES[10] === "Archived" &&
        !NON_LIFECYCLE_OUTCOMES.some((o) => (LIFECYCLE_STATES as readonly string[]).includes(o)),
      detail: LIFECYCLE_STATES.join(", "),
    });

    // Happy path Identified → Archived
    const rec = await makeRec(run.id, "Happy Path");
    await presentForReview(rec.id, "mgr");
    await approveRecommendation(rec.id, { performedBy: "mgr" });
    await assignPrimaryOwner(rec.id, {
      primaryOwnerUserId: "owner-1",
      primaryOwnerName: "Owner One",
      performedBy: "mgr",
    });
    await acceptAssignment(rec.id, { performedBy: "owner-1", ownerUserId: "owner-1" });
    await addContributor(rec.id, { userId: "contrib-1", displayName: "Helper", performedBy: "mgr" });
    await pauseRecommendation(rec.id, {
      reason: "Waiting on vendor",
      approvedBy: "exec-1",
      performedBy: "mgr",
    });
    await resumeRecommendation(rec.id, "mgr");
    await escalateRecommendation(rec.id, { reason: "Cash pressure", performedBy: "mgr" });
    await completeRecommendation(rec.id, "owner-1");
    await startOutcomeValidation(rec.id, "mgr");
    await passOutcomeValidation(rec.id, { performedBy: "mgr", reason: "Impact confirmed" });

    const final = await prisma.recommendation.findUnique({ where: { id: rec.id } });
    const events = await prisma.workflowEvent.findMany({
      where: { recommendationId: rec.id },
      orderBy: { eventTime: "asc" },
    });
    const audits = await prisma.auditEvent.findMany({ where: { entityId: rec.id } });
    const gov = await prisma.governanceDecision.findMany({ where: { recommendationId: rec.id } });
    const history = await prisma.recommendationAssignmentHistory.findMany({
      where: { recommendationId: rec.id },
    });
    const contributors = await prisma.recommendationContributor.findMany({
      where: { recommendationId: rec.id, active: true },
    });

    results.push({
      id: "P3-HAPPY",
      name: "Happy path Identified → Archived via OV",
      pass: final?.lifecycleState === "Archived" && events.length >= 8,
      detail: `state=${final?.lifecycleState} events=${events.length}`,
    });
    results.push({
      id: "P3-AUDIT",
      name: "Every governed path writes audit / workflow events",
      pass: audits.length >= 8 && gov.some((g) => g.decisionType === "Approve"),
      detail: `audits=${audits.length} gov=${gov.map((g) => g.decisionType).join(",")}`,
    });
    results.push({
      id: "P3-ASSIGN-HIST",
      name: "Assignment history + contributors",
      pass: history.some((h) => h.eventType === "assigned") && history.some((h) => h.eventType === "accepted") && contributors.length === 1,
      detail: `history=${history.map((h) => h.eventType).join(",")} contrib=${contributors.length}`,
    });

    // Invalid transition
    const rec2 = await makeRec(run.id, "Invalid");
    try {
      await transitionRecommendation({ recommendationId: rec2.id, toState: "Active" });
      results.push({ id: "P3-INVALID", name: "Invalid transition rejected", pass: false, detail: "expected throw" });
    } catch (e) {
      results.push({
        id: "P3-INVALID",
        name: "Invalid transition rejected",
        pass: e instanceof LifecycleTransitionError && e.code === "INVALID_TRANSITION",
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    // Archive without OV
    const rec3 = await makeRec(run.id, "No OV");
    await presentForReview(rec3.id);
    await approveRecommendation(rec3.id);
    await assignPrimaryOwner(rec3.id, { primaryOwnerUserId: "o2", performedBy: "mgr" });
    await acceptAssignment(rec3.id, { ownerUserId: "o2" });
    await completeRecommendation(rec3.id);
    try {
      await archiveRecommendation(rec3.id);
      results.push({ id: "P3-NO-OV", name: "Archive without Outcome Validation rejected", pass: false, detail: "expected throw" });
    } catch (e) {
      results.push({
        id: "P3-NO-OV",
        name: "Archive without Outcome Validation rejected",
        pass: e instanceof LifecycleTransitionError,
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    // Pause without reason
    const rec4 = await makeRec(run.id, "Pause");
    await presentForReview(rec4.id);
    await approveRecommendation(rec4.id);
    await assignPrimaryOwner(rec4.id, { primaryOwnerUserId: "o3" });
    await acceptAssignment(rec4.id, { ownerUserId: "o3" });
    try {
      await pauseRecommendation(rec4.id, { reason: "", approvedBy: "exec" });
      results.push({ id: "P3-PAUSE-REQ", name: "Pause without reason rejected", pass: false, detail: "expected throw" });
    } catch (e) {
      results.push({
        id: "P3-PAUSE-REQ",
        name: "Pause without reason rejected",
        pass: e instanceof LifecycleTransitionError,
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    // Defer is governance outcome — LS unchanged; not Deferred state
    const rec5 = await makeRec(run.id, "Defer");
    await presentForReview(rec5.id);
    const deferred = await deferRecommendation(rec5.id, { reason: "Revisit next cycle", performedBy: "mgr" });
    const deferGov = await prisma.governanceDecision.findFirst({
      where: { recommendationId: rec5.id, decisionType: "Defer" },
    });
    results.push({
      id: "P3-DEFER",
      name: "Defer is governance outcome (LS unchanged; not Deferred state)",
      pass:
        deferred.lifecycleState === "Management Review" &&
        Boolean(deferGov) &&
        !(await prisma.recommendation.findUnique({ where: { id: rec5.id } }))?.lifecycleState.includes("Defer") &&
        (await prisma.recommendation.findUnique({ where: { id: rec5.id } }))?.presentationCategory ===
          "deferred",
      detail: `ls=${deferred.lifecycleState} gov=${deferGov?.decisionType} present=${(await prisma.recommendation.findUnique({ where: { id: rec5.id } }))?.presentationCategory}`,
    });

    try {
      await approveRecommendation(rec5.id);
      results.push({ id: "P3-DEFER-BLOCK", name: "Defer blocks further LS transitions", pass: false, detail: "expected throw" });
    } catch (e) {
      results.push({
        id: "P3-DEFER-BLOCK",
        name: "Defer blocks further LS transitions",
        pass: e instanceof LifecycleTransitionError && e.code === "GOVERNANCE_BLOCK",
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    // Reject outcome
    const rec6 = await makeRec(run.id, "Reject");
    await presentForReview(rec6.id);
    const rejected = await rejectRecommendation(rec6.id, { reason: "Not material", performedBy: "mgr" });
    const rejectGov = await prisma.governanceDecision.findFirst({
      where: { recommendationId: rec6.id, decisionType: "Reject" },
    });
    const rec6After = await prisma.recommendation.findUnique({ where: { id: rec6.id } });
    results.push({
      id: "P3-REJECT",
      name: "Reject is governance outcome (not Rejected LS state)",
      pass:
        rejected.lifecycleState === "Management Review" &&
        Boolean(rejectGov) &&
        rec6After?.lifecycleState === "Management Review" &&
        rec6After.presentationCategory === "completed_presentation",
      detail: `ls=${rec6After?.lifecycleState} present=${rec6After?.presentationCategory}`,
    });

    // Active required acceptance
    const rec7 = await makeRec(run.id, "No Accept");
    await presentForReview(rec7.id);
    await approveRecommendation(rec7.id);
    await transitionRecommendation({ recommendationId: rec7.id, toState: "Assignment Pending" });
    // Assign without accept path: create assignment manually then try Active skip
    await prisma.recommendationAssignment.create({
      data: {
        recommendationId: rec7.id,
        primaryOwnerUserId: "o7",
        accepted: false,
        active: true,
      },
    });
    await transitionRecommendation({ recommendationId: rec7.id, toState: "Awaiting Acceptance" });
    try {
      await transitionRecommendation({ recommendationId: rec7.id, toState: "Active" });
      results.push({ id: "P3-ACCEPT-GATE", name: "Active requires owner acceptance", pass: false, detail: "expected throw" });
    } catch (e) {
      results.push({
        id: "P3-ACCEPT-GATE",
        name: "Active requires owner acceptance",
        pass: e instanceof LifecycleTransitionError,
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    // Cycle lock blocks transitions; Holdover not applied as LS
    const rec8 = await makeRec(run.id, "Lock");
    await presentForReview(rec8.id);
    await lockReviewCycle(run.id, { performedBy: "mgr" });
    const lockedRun = await prisma.iamRun.findUnique({ where: { id: run.id } });
    try {
      await approveRecommendation(rec8.id);
      results.push({ id: "P3-LOCK", name: "Locked cycle rejects transitions", pass: false, detail: "expected throw" });
    } catch (e) {
      results.push({
        id: "P3-LOCK",
        name: "Locked cycle rejects transitions",
        pass:
          e instanceof LifecycleTransitionError &&
          e.code === "CYCLE_LOCKED" &&
          lockedRun?.cycleStatus === "Locked" &&
          lockedRun.cycleLockedAt != null,
        detail: `status=${lockedRun?.cycleStatus} err=${e instanceof Error ? e.message : e}`,
      });
    }

    const anyHoldoverState = await prisma.recommendation.count({
      where: { iamRunId: run.id, lifecycleState: "Holdover" },
    });
    results.push({
      id: "P3-NO-HOLDOVER-LS",
      name: "Holdover is never a lifecycle state",
      pass: anyHoldoverState === 0,
      detail: `holdoverLsCount=${anyHoldoverState}`,
    });

    // Escalate = LS-08
    const run2 = await prisma.iamRun.create({
      data: {
        companyId: company.id,
        runName: "Phase3 Escalate Run",
        reviewDate: new Date(),
        reviewWeekStart: new Date(),
        reviewWeekEnd: new Date(),
        cycleStatus: "Open",
      },
    });
    const rec9 = await makeRec(run2.id, "Escalate");
    await presentForReview(rec9.id);
    await approveRecommendation(rec9.id);
    await assignPrimaryOwner(rec9.id, { primaryOwnerUserId: "o9" });
    await acceptAssignment(rec9.id, { ownerUserId: "o9" });
    await escalateRecommendation(rec9.id, { reason: "Needs exec" });
    const escalated = await prisma.recommendation.findUnique({ where: { id: rec9.id } });
    results.push({
      id: "P3-ESC-LS08",
      name: "Escalate moves to Escalated (LS-08)",
      pass: escalated?.lifecycleState === "Escalated",
      detail: escalated?.lifecycleState ?? "",
    });
    await prisma.iamRun.delete({ where: { id: run2.id } }).catch(() => undefined);
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
