import { NextResponse } from "next/server";
import {
  LifecycleTransitionError,
  presentForReview,
  approveRecommendation,
  deferRecommendation,
  reactivateDeferredRecommendation,
  rejectRecommendation,
  startAssignment,
  assignPrimaryOwner,
  acceptAssignment,
  addContributor,
  pauseRecommendation,
  resumeRecommendation,
  escalateRecommendation,
  completeRecommendation,
  startOutcomeValidation,
  passOutcomeValidation,
} from "@/lib/iam/lifecycle";

type Action =
  | "present_for_review"
  | "approve"
  | "defer"
  | "reactivate_defer"
  | "reject"
  | "start_assignment"
  | "assign"
  | "accept"
  | "add_contributor"
  | "pause"
  | "resume"
  | "escalate"
  | "complete"
  | "start_outcome_validation"
  | "pass_outcome_validation";

/**
 * POST /api/recommendations/[id]/transition
 * Named governance actions only (DF-03) — raw free-form LS transition is not exposed.
 * Every action validates through the lifecycle engine before any durable write.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action ?? "") as Action;
    const performedBy = typeof body.performedBy === "string" ? body.performedBy : undefined;

    if (String(body.action ?? "") === "transition") {
      return NextResponse.json(
        {
          error:
            "Raw transition action is disabled. Use a named governance action (approve, pause, escalate, etc.).",
          code: "RAW_TRANSITION_DISABLED",
        },
        { status: 400 }
      );
    }

    let result: unknown;
    switch (action) {
      case "present_for_review":
        result = await presentForReview(id, performedBy);
        break;
      case "approve":
        result = await approveRecommendation(id, {
          performedBy,
          reason: typeof body.reason === "string" ? body.reason : undefined,
        });
        break;
      case "defer":
        result = await deferRecommendation(id, {
          performedBy,
          reason: String(body.reason ?? ""),
        });
        break;
      case "reactivate_defer":
        result = await reactivateDeferredRecommendation(id, {
          performedBy,
          reason: typeof body.reason === "string" ? body.reason : undefined,
        });
        break;
      case "reject":
        result = await rejectRecommendation(id, {
          performedBy,
          reason: String(body.reason ?? ""),
        });
        break;
      case "start_assignment":
        result = await startAssignment(id, performedBy);
        break;
      case "assign":
        result = await assignPrimaryOwner(id, {
          primaryOwnerUserId: String(body.primaryOwnerUserId ?? ""),
          primaryOwnerName:
            typeof body.primaryOwnerName === "string" ? body.primaryOwnerName : undefined,
          performedBy,
        });
        break;
      case "accept":
        result = await acceptAssignment(id, {
          performedBy,
          ownerUserId: typeof body.ownerUserId === "string" ? body.ownerUserId : undefined,
        });
        break;
      case "add_contributor":
        result = await addContributor(id, {
          userId: String(body.userId ?? ""),
          displayName: typeof body.displayName === "string" ? body.displayName : undefined,
          performedBy,
        });
        break;
      case "pause":
        result = await pauseRecommendation(id, {
          reason: String(body.reason ?? ""),
          approvedBy: String(body.approvedBy ?? ""),
          performedBy,
        });
        break;
      case "resume":
        result = await resumeRecommendation(id, performedBy);
        break;
      case "escalate":
        result = await escalateRecommendation(id, {
          reason: String(body.reason ?? ""),
          performedBy,
        });
        break;
      case "complete":
        result = await completeRecommendation(id, performedBy);
        break;
      case "start_outcome_validation":
        result = await startOutcomeValidation(id, performedBy);
        break;
      case "pass_outcome_validation":
        result = await passOutcomeValidation(id, {
          performedBy,
          reason: typeof body.reason === "string" ? body.reason : undefined,
        });
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({
      status: "ok",
      action,
      payload: slimTransitionPayload(result),
    });
  } catch (err) {
    console.error(err);
    if (err instanceof LifecycleTransitionError) {
      const status =
        err.code === "NOT_FOUND" ? 404 : err.code === "CYCLE_LOCKED" ? 409 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Transition failed" },
      { status: 500 }
    );
  }
}

/** Avoid returning multi-100KB explainability blobs on every Present/Approve response. */
function slimTransitionPayload(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  return {
    id: r.id,
    lifecycleState: r.lifecycleState,
    presentationCategory: r.presentationCategory,
    presentationRank: r.presentationRank,
    title: r.title,
    opportunityKey: r.opportunityKey,
  };
}
