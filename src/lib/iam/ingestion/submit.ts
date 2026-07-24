/**
 * Unified evidence submission — single path after adapter/Port upsert.
 */

import { prisma } from "@/lib/db";
import { upsertEvidenceBatch, type EvidencePackageInput } from "@/lib/iam/inbound";
import { normalizeSourceChannel } from "./source-priority";
import { reconcileEvidenceForRun } from "./reconcile";

export class IngestionError extends Error {
  constructor(
    message: string,
    public readonly code: "DISABLED" | "VALIDATION" | "NOT_FOUND" = "VALIDATION"
  ) {
    super(message);
    this.name = "IngestionError";
  }
}

async function assertChannelEnabled(iamRunId: string, sourceSystem: string) {
  const run = await prisma.iamRun.findUnique({
    where: { id: iamRunId },
    include: { company: true },
  });
  if (!run) throw new IngestionError("Review cycle not found", "NOT_FOUND");
  const channel = normalizeSourceChannel(sourceSystem);
  const c = run.company;
  if (channel === "Keystroke" || channel === "CustomerUpload") {
    if (!c.enableStandaloneUpload) {
      throw new IngestionError("Standalone / customer upload is disabled for this company", "DISABLED");
    }
  } else if (channel === "RSE") {
    if (!c.enableRseEvidence) {
      throw new IngestionError("RSE evidence channel is disabled for this company", "DISABLED");
    }
  } else if (channel === "DataHub") {
    if (!c.enableDataHub) {
      throw new IngestionError("Data Hub evidence channel is disabled for this company", "DISABLED");
    }
  }
  return { run, channel };
}

/**
 * Submit an Evidence Package through the Inbound Port, then reconcile + require approval.
 * All sources (Keystroke, RSE, Data Hub, customer upload) use this path.
 */
export async function submitEvidenceThroughUnifiedIngestion(
  pkg: EvidencePackageInput
): Promise<{
  evidenceBatchId: string;
  channel: string;
  inventoryRows: number;
  demandRows: number;
  supplyRows: number;
  supersededPriorBatch: boolean;
  reconcile: Awaited<ReturnType<typeof reconcileEvidenceForRun>>;
}> {
  const { channel } = await assertChannelEnabled(pkg.reviewCycleId, pkg.sourceSystem);
  const result = await upsertEvidenceBatch(pkg);
  await prisma.evidenceBatch.update({
    where: { id: result.evidenceBatchId },
    data: { sourceChannel: channel, status: "accepted" },
  });
  const reconcile = await reconcileEvidenceForRun(pkg.reviewCycleId);
  return {
    evidenceBatchId: result.evidenceBatchId,
    channel,
    inventoryRows: result.inventoryRows,
    demandRows: result.demandRows,
    supplyRows: result.supplyRows,
    supersededPriorBatch: result.supersededPriorBatch,
    reconcile,
  };
}

export async function approveEvidenceForAnalysis(
  iamRunId: string,
  performedBy: string
): Promise<{ status: string }> {
  const run = await prisma.iamRun.findUnique({ where: { id: iamRunId } });
  if (!run) throw new IngestionError("Review cycle not found", "NOT_FOUND");

  const selectedInv = await prisma.inventorySnapshot.count({
    where: { iamRunId, selectedForAnalysis: true },
  });
  if (selectedInv === 0) {
    throw new IngestionError("No inventory evidence selected for analysis — ingest and reconcile first");
  }

  await prisma.iamRun.update({
    where: { id: iamRunId },
    data: {
      evidenceApprovalStatus: "approved",
      evidenceApprovedAt: new Date(),
      evidenceApprovedBy: performedBy,
    },
  });

  await prisma.auditEvent.create({
    data: {
      iamRunId,
      entityType: "IamRun",
      entityId: iamRunId,
      action: "evidence_approved_for_analysis",
      performedBy,
      detailJson: JSON.stringify({ selectedInventoryRows: selectedInv }),
    },
  });

  return { status: "approved" };
}

export async function assertEvidenceApprovedForAnalysis(iamRunId: string) {
  const run = await prisma.iamRun.findUnique({ where: { id: iamRunId } });
  if (!run) throw new IngestionError("Review cycle not found", "NOT_FOUND");
  if (run.evidenceApprovalStatus !== "approved") {
    throw new IngestionError(
      `Evidence is not approved for analysis (status=${run.evidenceApprovalStatus}). Approve evidence before Calculate.`,
      "VALIDATION"
    );
  }
}

export async function getIngestionStatus(iamRunId: string) {
  const run = await prisma.iamRun.findUnique({
    where: { id: iamRunId },
    include: { company: true },
  });
  if (!run) throw new IngestionError("Review cycle not found", "NOT_FOUND");
  const batches = await prisma.evidenceBatch.findMany({ where: { iamRunId } });
  const conflicts = await prisma.evidenceConflict.count({ where: { iamRunId } });
  const selectedInv = await prisma.inventorySnapshot.count({
    where: { iamRunId, selectedForAnalysis: true },
  });
  const selectedDem = await prisma.demandHistory.count({
    where: { iamRunId, selectedForAnalysis: true },
  });
  return {
    evidenceApprovalStatus: run.evidenceApprovalStatus,
    evidenceApprovedAt: run.evidenceApprovedAt,
    evidenceApprovedBy: run.evidenceApprovedBy,
    channelsEnabled: {
      standaloneUpload: run.company.enableStandaloneUpload,
      rseEvidence: run.company.enableRseEvidence,
      dataHub: run.company.enableDataHub,
    },
    batches: batches.map((b) => ({
      id: b.id,
      sourceSystem: b.sourceSystem,
      sourceChannel: b.sourceChannel,
      sourceReportType: b.sourceReportType,
      status: b.status,
      itemCount: b.itemCount,
    })),
    selectedInventoryRows: selectedInv,
    selectedDemandRows: selectedDem,
    conflictCount: conflicts,
  };
}
