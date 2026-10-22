/**
 * Stage 4D: "Mark board reviewed". The explicit management record that bounds "What Changed Since Last Review".
 * Append-only; it changes no workflow, scoring or health data.
 */
import type { PrismaClient } from "@prisma/client";
import { writeAudit } from "../audit";
import { DposError, type Db } from "../errors";
import { isValidIanaTimeZone } from "../contract/iam-results-return";
import { assertStableUserId } from "../scoring/ledger";
import { optionalText } from "../workflow/internal";
import { requireManagement, type WorkflowActor } from "../workflow/permissions";
import { operatingWeekFor } from "./time";

type Ctx = { dposCompanyId: string; companyTimeZone?: string | null };

export async function markBoardReviewed(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, input: { note?: string; at?: Date } = {}) {
  requireManagement(actor, "Marking the Decision Board reviewed");
  assertStableUserId(actor, "Marking the Decision Board reviewed");
  const at = input.at ?? new Date();
  const note = optionalText(input.note, "note", 2000);
  const tz = ctx.companyTimeZone ?? (await db.dposCompanyBinding.findUnique({ where: { dposCompanyId: ctx.dposCompanyId }, select: { companyTimeZone: true } }))?.companyTimeZone ?? null;
  if (!tz || !isValidIanaTimeZone(tz)) {
    throw new DposError("COMPANY_TIME_ZONE_REQUIRED", "The review cycle is the company-local operating week, so the company needs a valid IANA time zone configured. There is no UTC fallback.", 409, { companyTimeZone: tz });
  }
  const week = operatingWeekFor(at, tz).start;
  return db.$transaction(async (tx) => {
    const latestHealth = await tx.iamCoreHealthScore.findFirst({ where: { dposCompanyId: ctx.dposCompanyId, calculatedAt: { lte: at } }, orderBy: [{ calculatedAt: "desc" }, { createdAt: "desc" }], select: { healthScoreId: true } });
    const row = await tx.iamCoreBoardReview.create({
      data: { dposCompanyId: ctx.dposCompanyId, reviewedAt: at, reviewedBy: actor.actorId, reviewedByRole: actor.role, operatingWeekStart: week, healthScoreId: latestHealth?.healthScoreId ?? null, note },
    });
    await writeAudit(tx, { category: "BOARD", action: "BOARD_REVIEWED", outcome: "SUCCESS", actor: actor.actorId, dposCompanyId: ctx.dposCompanyId, subjectType: "IamCoreBoardReview", subjectId: row.reviewId, detail: { operatingWeekStart: week }, at });
    return { reviewId: row.reviewId, reviewedAt: row.reviewedAt.toISOString(), reviewedBy: row.reviewedBy, operatingWeekStart: week, healthScoreId: row.healthScoreId };
  });
}

export async function latestBoardReview(db: Db, companyId: string, before?: Date) {
  return db.iamCoreBoardReview.findFirst({ where: { dposCompanyId: companyId, ...(before ? { reviewedAt: { lte: before } } : {}) }, orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }] });
}
