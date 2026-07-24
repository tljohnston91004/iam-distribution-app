import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { IamRunNav } from "@/components/IamRunNav";
import { RecommendationDetailClient } from "@/components/RecommendationDetailClient";
import type { BoardPersona } from "@/lib/iam/board/types";

export const dynamic = "force-dynamic";

export default async function RecommendationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string; id: string }>;
  searchParams: Promise<{ viewAs?: string }>;
}) {
  const { runId, id } = await params;
  const { viewAs } = await searchParams;
  const persona: BoardPersona =
    viewAs === "operations" || viewAs === "owner" || viewAs === "executive" ? viewAs : "executive";

  const rec = await prisma.recommendation.findFirst({
    where: { id, iamRunId: runId },
    include: {
      assignments: { where: { active: true }, take: 1 },
      contributors: { where: { active: true } },
      notes: { orderBy: { createdAt: "asc" } },
      governanceDecisions: { orderBy: { performedAt: "desc" }, take: 30 },
      workflowEvents: { orderBy: { eventTime: "desc" }, take: 40 },
    },
  });
  if (!rec) notFound();

  const notes =
    persona === "owner" ? rec.notes.filter((n) => n.visibility === "shared") : rec.notes;
  const a = rec.assignments[0];

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <IamRunNav runId={runId} active="dashboard" />
      <RecommendationDetailClient
        runId={runId}
        persona={persona}
        detail={{
          id: rec.id,
          title: rec.title,
          recommendationType: rec.recommendationType,
          skuOrItemId: rec.skuOrItemId,
          lifecycleState: rec.lifecycleState,
          presentationCategory: rec.presentationCategory,
          generationPath: rec.generationPath,
          sourceModule: rec.sourceModule,
          confidence: rec.confidence,
          priorityScore: rec.priorityScore,
          scoringProfileId: rec.scoringProfileId,
          estimatedFinancialImpact: rec.estimatedFinancialImpact,
          estimatedCashImpact: rec.estimatedCashImpact,
          costOfInaction: rec.costOfInaction,
          explainabilityJson: rec.explainabilityJson,
          storyWhat: rec.storyWhat,
          storyWhy: rec.storyWhy,
          storyWhyNow: rec.storyWhyNow,
          storyExpectedResult: rec.storyExpectedResult,
          confidenceNarrative: rec.confidenceNarrative,
          progressNarrative: rec.progressNarrative,
          blockerNote: rec.blockerNote,
          ownerUserId: a?.primaryOwnerUserId ?? null,
          ownerName: a?.primaryOwnerName ?? null,
          ownerAccepted: a?.accepted ?? false,
          contributors: rec.contributors.map((c) => ({
            userId: c.userId,
            displayName: c.displayName,
          })),
          notes: notes.map((n) => ({
            id: n.id,
            body: n.body,
            visibility: n.visibility,
            authoredBy: n.authoredBy,
            createdAt: n.createdAt.toISOString(),
          })),
          governance: rec.governanceDecisions.map((g) => ({
            decisionType: g.decisionType,
            reason: g.reason,
            performedBy: g.performedBy,
            performedAt: g.performedAt.toISOString(),
          })),
          workflow: rec.workflowEvents.map((w) => ({
            fromState: w.fromState,
            toState: w.toState,
            performedBy: w.performedBy,
            performedAt: w.eventTime.toISOString(),
          })),
        }}
      />
    </main>
  );
}
