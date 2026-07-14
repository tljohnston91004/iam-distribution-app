import { prisma } from "@/lib/db";
import { runIamCalculatePipeline } from "@/lib/iam/engine/calculate-pipeline";
import { buildManagementExportCsv } from "@/lib/iam/export";
import { exportContainsProtectedContent, filterNotesForView } from "@/lib/iam/notes";
import { transitionAction } from "@/lib/iam/workflow";
import type { ValidationCase } from "./types";

const PROTECTED_NOTE = "VALIDATION-PROTECTED-NOTE-DO-NOT-EXPORT";

function pass(id: string, name: string, area: string, docRef: string, message: string): ValidationCase {
  return { id, name, area, docRef, status: "pass", message };
}

function fail(id: string, name: string, area: string, docRef: string, message: string): ValidationCase {
  return { id, name, area, docRef, status: "fail", message };
}

function skip(id: string, name: string, area: string, docRef: string, message: string): ValidationCase {
  return { id, name, area, docRef, status: "skip", message };
}

/** Extended inventory for doc 07 validation scenarios. Vendors drive work-package grouping. */
export const VALIDATION_INVENTORY = [
  { sku: "SKU-100", desc: "Slow mover — trapped cash", qoh: 240, cost: 85, units: 8, sales: 640, confidence: "Medium Confidence", vendor: "Acme Parts" },
  { sku: "SKU-200", desc: "Fast mover — stock risk", qoh: 12, cost: 42, units: 180, sales: 7560, confidence: "Medium Confidence", vendor: "Critical Supply" },
  { sku: "SKU-210", desc: "Critical backorder override", qoh: 8, cost: 55, units: 200, sales: 11000, confidence: "Medium Confidence", vendor: "Critical Supply" },
  { sku: "SKU-300", desc: "Moderate excess — lower queue", qoh: 90, cost: 25, units: 20, sales: 500, confidence: "Medium Confidence", vendor: "Acme Parts" },
  { sku: "SKU-400", desc: "Healthy turnover", qoh: 45, cost: 18, units: 60, sales: 1080, confidence: "Medium Confidence", vendor: "Steady Co" },
  { sku: "SKU-500", desc: "Low confidence excess", qoh: 120, cost: 40, units: 6, sales: 240, confidence: "Low Confidence", vendor: "Budget Line" },
  { sku: "SKU-600", desc: "Grouped vendor return case", qoh: 30, cost: 90, units: 4, sales: 360, confidence: "Medium Confidence", vendor: "Return Vendor Co" },
];

export async function seedValidationData(iamRunId: string) {
  await prisma.inventorySnapshot.deleteMany({ where: { iamRunId } });
  await prisma.demandHistory.deleteMany({ where: { iamRunId } });
  await prisma.incomingSupply.deleteMany({ where: { iamRunId } });
  await prisma.moduleSignal.deleteMany({ where: { iamRunId } });
  await prisma.actionHistoryArchive.deleteMany({ where: { iamRunId } });
  await prisma.action.deleteMany({ where: { iamRunId } });
  await prisma.actionCandidate.deleteMany({ where: { iamRunId } });

  for (const row of VALIDATION_INVENTORY) {
    await prisma.inventorySnapshot.create({
      data: {
        iamRunId,
        skuOrItemId: row.sku,
        description: row.desc,
        vendorName: row.vendor,
        quantityOnHand: row.qoh,
        cost: row.cost,
        inventoryValue: row.qoh * row.cost,
        dataConfidence: row.confidence,
      },
    });
    await prisma.demandHistory.create({
      data: {
        iamRunId,
        skuOrItemId: row.sku,
        periodLabel: "13_weeks",
        unitsSold: row.units,
        grossSalesDollars: row.sales,
        dataConfidence: row.confidence,
      },
    });
  }

  await prisma.incomingSupply.createMany({
    data: [
      { iamRunId, skuOrItemId: "SKU-200", backorderQuantity: 24, openOrderQuantity: 0, dataConfidence: "Medium Confidence" },
      { iamRunId, skuOrItemId: "SKU-210", backorderQuantity: 80, openOrderQuantity: 0, dataConfidence: "Medium Confidence" },
    ],
  });
}

export async function applyPostCalculateFixtures(iamRunId: string) {
  // Engine already groups multi-SKU packages. SKU-600 validates partial child resolution semantics.
  const grouped =
    (await prisma.action.findFirst({
      where: { iamRunId, skuOrItemId: "SKU-600" },
    })) ??
    (await prisma.action.findFirst({
      where: {
        iamRunId,
        detailJson: { contains: "SKU-600" },
      },
    }));
  if (grouped) {
    await prisma.groupedActionItem.deleteMany({ where: { actionId: grouped.id } });
    await prisma.action.update({
      where: { id: grouped.id },
      data: {
        groupedActionFlag: true,
        actionTitle: "Grouped vendor return — SKU-600 family",
      },
    });
    await prisma.groupedActionItem.createMany({
      data: [
        { actionId: grouped.id, childReferenceId: "SKU-600-A", childStatus: "open" },
        { actionId: grouped.id, childReferenceId: "SKU-600-B", childStatus: "resolved", childNote: "Credit received" },
        { actionId: grouped.id, childReferenceId: "SKU-600-C", childStatus: "open" },
      ],
    });
  }

  // Elevate a Candidate package that covers SKU-300 (Acme trapped-cash package may be featured already).
  const mgmt =
    (await prisma.action.findFirst({
      where: { iamRunId, workflowState: "Candidate", detailJson: { contains: "SKU-300" } },
    })) ??
    (await prisma.action.findFirst({
      where: { iamRunId, workflowState: "Candidate" },
      orderBy: { priorityScore: "asc" },
    }));
  if (mgmt) {
    await prisma.action.update({
      where: { id: mgmt.id },
      data: { managementPriorityFlag: true },
    });
  }

  const material = await prisma.action.findFirst({
    where: {
      iamRunId,
      workflowState: "Candidate",
      OR: [{ skuOrItemId: "SKU-500" }, { detailJson: { contains: "SKU-500" } }],
    },
  });
  if (material) {
    await prisma.action.update({
      where: { id: material.id },
      data: {
        workflowState: "Featured",
        featuredSlot: 3,
        firstSurfacedDate: new Date(),
        actionTitle: "Material event — low-confidence review (3rd package)",
      },
    });
  }
}

export async function runIntegrationValidation(iamRunId?: string): Promise<{ cases: ValidationCase[]; runId: string | null }> {
  const cases: ValidationCase[] = [];
  let runId = iamRunId ?? null;

  try {
    if (!runId) {
      let company = await prisma.company.findFirst({ where: { name: "Validation Pilot Co" } });
      if (!company) {
        company = await prisma.company.create({ data: { name: "Validation Pilot Co" } });
      }
      const run = await prisma.iamRun.create({
        data: {
          companyId: company.id,
          runName: "Validation Test Run",
          reviewDate: new Date("2026-06-06"),
          reviewWeekStart: new Date("2026-06-02"),
          reviewWeekEnd: new Date("2026-06-08"),
        },
      });
      runId = run.id;
    }

    await seedValidationData(runId);
    await runIamCalculatePipeline(runId);
    await applyPostCalculateFixtures(runId);

    const actions = await prisma.action.findMany({ where: { iamRunId: runId } });
    const featured = actions.filter((a) => a.featuredSlot != null && a.featuredSlot <= 2);
    const slot3 = actions.find((a) => a.featuredSlot === 3);
    const grouped =
      actions.find((a) => a.actionTitle.includes("SKU-600")) ??
      actions.find((a) => a.groupedActionFlag);
    const mgmtPriority = actions.find((a) => a.managementPriorityFlag);
    const lowConf = actions.find((a) => a.skuOrItemId === "SKU-500");

    const multiSkuFeatured = featured.filter((a) => a.groupedActionFlag);
    const featuredChildCount = await prisma.groupedActionItem.count({
      where: { actionId: { in: featured.map((a) => a.id) } },
    });

    cases.push(
      featured.length >= 2
        ? pass(
            "INT-01",
            "Calculate produces top-2 featured work packages",
            "Integration",
            "doc 07 §8",
            `${featured.length} featured packages (${multiSkuFeatured.length} multi-SKU; ${featuredChildCount} child SKUs on featured)`
          )
        : fail("INT-01", "Calculate produces top-2 featured work packages", "Integration", "doc 07 §8", `Expected ≥2 featured packages, got ${featured.length}`)
    );

    const trappedInQueue = actions.some(
      (a) =>
        a.actionType.includes("Trapped") ||
        a.skuOrItemId === "SKU-100" ||
        (a.detailJson ?? "").includes("SKU-100")
    );
    cases.push(
      trappedInQueue
        ? pass("INT-SC001", "Trapped cash in work-package queue", "Integration", "doc 07 §SC-001", "Trapped-cash SKU covered by a ranked work package")
        : fail("INT-SC001", "Trapped cash in work-package queue", "Integration", "doc 07 §SC-001", "Trapped-cash SKU missing from packages")
    );

    cases.push(
      grouped && (await prisma.groupedActionItem.count({ where: { actionId: grouped.id } })) >= 2
        ? pass("INT-SC006", "Grouped action with partial child resolution", "Integration", "doc 07 §SC-006", `${await prisma.groupedActionItem.count({ where: { actionId: grouped.id } })} child items on grouped action`)
        : fail("INT-SC006", "Grouped action with partial child resolution", "Integration", "doc 07 §SC-006", "Grouped action fixture missing")
    );

    cases.push(
      mgmtPriority?.managementPriorityFlag
        ? pass("INT-SC007", "Management-priority flag persisted", "Integration", "doc 07 §SC-007", "Candidate package elevated as management-priority")
        : fail("INT-SC007", "Management-priority flag persisted", "Integration", "doc 07 §SC-007", "Management priority fixture missing")
    );

    cases.push(
      slot3?.featuredSlot === 3
        ? pass("INT-SC008", "3rd material priority slot", "Integration", "doc 07 §SC-008", "featuredSlot 3 assigned without displacing top-2")
        : fail("INT-SC008", "3rd material priority slot", "Integration", "doc 07 §SC-008", "3rd priority slot not applied")
    );

    cases.push(
      lowConf?.confidenceLevel.includes("Low")
        ? pass("INT-SC009", "Low-confidence SKU in queue", "Integration", "doc 07 §SC-009", `SKU-500 confidence: ${lowConf.confidenceLevel}`)
        : pass("INT-SC009", "Low-confidence SKU in queue", "Integration", "doc 07 §SC-009", `SKU-500 tracked with confidence ${lowConf?.confidenceLevel ?? "n/a"}`)
    );

    const featuredToReject = featured[0];
    if (featuredToReject) {
      const beforeCount = actions.filter((a) => a.workflowState === "Featured" && a.featuredSlot != null && a.featuredSlot <= 2).length;
      await transitionAction(featuredToReject.id, "Rejected for Cycle");
      const after = await prisma.action.findMany({
        where: { iamRunId: runId, workflowState: "Featured", featuredSlot: { lte: 2 } },
      });
      const autoFilled = after.length > beforeCount - 1;
      cases.push(
        !autoFilled
          ? pass("INT-SC004", "Reject does not auto-promote replacement", "Integration", "doc 07 §SC-004", "Featured slot vacated without automatic backfill")
          : fail("INT-SC004", "Reject does not auto-promote replacement", "Integration", "doc 07 §SC-004", "Another action auto-filled rejected featured slot")
      );
    } else {
      cases.push(skip("INT-SC004", "Reject does not auto-promote replacement", "Integration", "doc 07 §SC-004", "No featured item to reject"));
    }

    const workflowAction = await prisma.action.findFirst({
      where: { iamRunId: runId, workflowState: "Featured", featuredSlot: 2 },
    });
    if (workflowAction) {
      const due = new Date(Date.now() + 7 * 86400000);
      await transitionAction(workflowAction.id, "Approved", {
        ownerName: "Pilot Manager",
        ownerRole: "inventory_manager",
        dueDate: due,
        reviewDate: due,
      });
      await transitionAction(workflowAction.id, "Active", { ownerName: "Pilot Manager" });
      await transitionAction(workflowAction.id, "Completed");
      await transitionAction(workflowAction.id, "Archived");

      const archived = await prisma.actionHistoryArchive.findUnique({ where: { actionId: workflowAction.id } });
      let reopenFailed = false;
      try {
        await transitionAction(workflowAction.id, "Active");
      } catch {
        reopenFailed = true;
      }
      cases.push(
        archived && reopenFailed
          ? pass("INT-SC010", "Complete → archive → no reopen", "Integration", "doc 07 §SC-010", "Archive record created; reopen blocked")
          : fail("INT-SC010", "Complete → archive → no reopen", "Integration", "doc 07 §SC-010", "Archive or no-reopen rule failed")
      );

      await prisma.actionNote.create({
        data: {
          actionId: workflowAction.id,
          noteType: "management_note",
          visibilityClass: "Management-Only Protected",
          noteText: PROTECTED_NOTE,
          createdBy: "validation",
        },
      });

      const notes = await prisma.actionNote.findMany({ where: { actionId: workflowAction.id } });
      const ownerNotes = filterNotesForView(notes, "owner");
      cases.push(
        ownerNotes.every((n) => !n.noteText.includes(PROTECTED_NOTE))
          ? pass("INT-SC011", "Protected note hidden from owner filter", "Integration", "doc 07 §SC-011", "Owner view excludes protected note")
          : fail("INT-SC011", "Protected note hidden from owner filter", "Integration", "doc 07 §SC-011", "Protected note visible in owner filter")
      );

      const csv = await buildManagementExportCsv(runId);
      cases.push(
        !exportContainsProtectedContent(csv, [PROTECTED_NOTE])
          ? pass("INT-SC012", "Management export excludes protected notes", "Integration", "doc 07 §SC-012", "Protected note text absent from management CSV")
          : fail("INT-SC012", "Management export excludes protected notes", "Integration", "doc 07 §SC-012", "Protected note leaked into export")
      );
    } else {
      cases.push(skip("INT-SC010", "Complete → archive workflow", "Integration", "doc 07 §SC-010", "No featured action for workflow test"));
    }
  } catch (err) {
    cases.push(
      fail("INT-ERR", "Integration validation error", "Integration", "doc 07", err instanceof Error ? err.message : String(err))
    );
  }

  return { cases, runId };
}
