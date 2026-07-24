/**
 * Reconcile multi-source evidence into a single analysis selection set.
 * Does not change scoring formulas — only which evidence rows Calculate reads.
 */

import { prisma } from "@/lib/db";
import {
  SOURCE_PRIORITY_RULE_ID,
  channelPriority,
  normalizeSourceChannel,
  type EvidenceSourceChannel,
} from "./source-priority";

export type ReconcileResult = {
  inventorySelected: number;
  demandSelected: number;
  conflictsRecorded: number;
  sourcesPresent: EvidenceSourceChannel[];
};

function usableQty(row: { availableQoh: number | null; quantityOnHand: number; quantityBasisUsed: string | null }) {
  if (row.quantityBasisUsed === "available_qoh" && row.availableQoh != null) return row.availableQoh;
  if (row.availableQoh != null) return row.availableQoh;
  return row.quantityOnHand;
}

export async function reconcileEvidenceForRun(iamRunId: string): Promise<ReconcileResult> {
  const batches = await prisma.evidenceBatch.findMany({
    where: { iamRunId, status: { in: ["accepted", "pending_reconcile"] } },
  });
  const batchChannel = new Map<string, EvidenceSourceChannel>();
  const sourcesPresent = new Set<EvidenceSourceChannel>();
  for (const b of batches) {
    const ch = (b.sourceChannel as EvidenceSourceChannel) || normalizeSourceChannel(b.sourceSystem);
    batchChannel.set(b.id, ch);
    sourcesPresent.add(ch);
  }

  await prisma.evidenceConflict.deleteMany({ where: { iamRunId } });

  const inventory = await prisma.inventorySnapshot.findMany({ where: { iamRunId } });
  const bySkuInv = new Map<string, typeof inventory>();
  for (const row of inventory) {
    const list = bySkuInv.get(row.skuOrItemId) ?? [];
    list.push(row);
    bySkuInv.set(row.skuOrItemId, list);
  }

  let inventorySelected = 0;
  let conflictsRecorded = 0;

  for (const [sku, rows] of bySkuInv) {
    const ranked = [...rows].sort((a, b) => {
      const ca = a.evidenceBatchId ? batchChannel.get(a.evidenceBatchId) ?? "Other" : "Other";
      const cb = b.evidenceBatchId ? batchChannel.get(b.evidenceBatchId) ?? "Other" : "Other";
      const pd = channelPriority(cb) - channelPriority(ca);
      if (pd !== 0) return pd;
      return b.id.localeCompare(a.id);
    });
    const winner = ranked[0];
    const winCh = winner.evidenceBatchId
      ? batchChannel.get(winner.evidenceBatchId) ?? "Other"
      : "Other";
    const winQty = usableQty(winner);

    for (const row of ranked) {
      const isWin = row.id === winner.id;
      await prisma.inventorySnapshot.update({
        where: { id: row.id },
        data: {
          selectedForAnalysis: isWin,
          winningSourceSystem: winCh,
        },
      });
      if (isWin) inventorySelected += 1;
      else {
        const loseCh = row.evidenceBatchId
          ? batchChannel.get(row.evidenceBatchId) ?? "Other"
          : "Other";
        const loseQty = usableQty(row);
        if (Math.abs(winQty - loseQty) > 0.0001) {
          await prisma.evidenceConflict.create({
            data: {
              iamRunId,
              skuOrItemId: sku,
              domain: "inventory",
              winningSource: winCh,
              losingSource: loseCh,
              winningValue: String(winQty),
              losingValue: String(loseQty),
              resolutionRule: SOURCE_PRIORITY_RULE_ID,
              detailJson: JSON.stringify({ winnerId: winner.id, loserId: row.id }),
            },
          });
          conflictsRecorded += 1;
        }
      }
    }
  }

  const demand = await prisma.demandHistory.findMany({ where: { iamRunId } });
  const bySkuDem = new Map<string, typeof demand>();
  for (const row of demand) {
    const list = bySkuDem.get(row.skuOrItemId) ?? [];
    list.push(row);
    bySkuDem.set(row.skuOrItemId, list);
  }

  let demandSelected = 0;
  for (const [sku, rows] of bySkuDem) {
    const ranked = [...rows].sort((a, b) => {
      const ca = a.evidenceBatchId ? batchChannel.get(a.evidenceBatchId) ?? "Other" : "Other";
      const cb = b.evidenceBatchId ? batchChannel.get(b.evidenceBatchId) ?? "Other" : "Other";
      const pd = channelPriority(cb) - channelPriority(ca);
      if (pd !== 0) return pd;
      return b.id.localeCompare(a.id);
    });
    const winner = ranked[0];
    const winCh = winner.evidenceBatchId
      ? batchChannel.get(winner.evidenceBatchId) ?? "Other"
      : "Other";

    for (const row of ranked) {
      const isWin = row.id === winner.id;
      await prisma.demandHistory.update({
        where: { id: row.id },
        data: {
          selectedForAnalysis: isWin,
          winningSourceSystem: winCh,
        },
      });
      if (isWin) demandSelected += 1;
      else if (Math.abs(row.unitsSold - winner.unitsSold) > 0.0001) {
        const loseCh = row.evidenceBatchId
          ? batchChannel.get(row.evidenceBatchId) ?? "Other"
          : "Other";
        await prisma.evidenceConflict.create({
          data: {
            iamRunId,
            skuOrItemId: sku,
            domain: "demand",
            winningSource: winCh,
            losingSource: loseCh,
            winningValue: String(winner.unitsSold),
            losingValue: String(row.unitsSold),
            resolutionRule: SOURCE_PRIORITY_RULE_ID,
          },
        });
        conflictsRecorded += 1;
      }
    }
  }

  await prisma.iamRun.update({
    where: { id: iamRunId },
    data: {
      evidenceApprovalStatus: "pending_approval",
      evidenceApprovedAt: null,
      evidenceApprovedBy: null,
    },
  });

  await prisma.changeLog.create({
    data: {
      iamRunId,
      entityType: "IamRun",
      entityId: iamRunId,
      action: "evidence_reconciled",
      detail: JSON.stringify({
        rule: SOURCE_PRIORITY_RULE_ID,
        inventorySelected,
        demandSelected,
        conflictsRecorded,
        sourcesPresent: [...sourcesPresent],
      }),
    },
  });

  return {
    inventorySelected,
    demandSelected,
    conflictsRecorded,
    sourcesPresent: [...sourcesPresent],
  };
}
