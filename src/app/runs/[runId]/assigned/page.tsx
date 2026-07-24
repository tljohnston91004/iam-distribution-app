import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { IamRunNav } from "@/components/IamRunNav";
import { AssignedRecommendationsPanel } from "@/components/AssignedRecommendationsPanel";
import type { BoardRecommendation } from "@/lib/iam/board/types";

export const dynamic = "force-dynamic";

export default async function AssignedViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ owner?: string }>;
}) {
  const { runId } = await params;
  const { owner } = await searchParams;
  const ownerFilter = owner ?? "Pilot Manager";

  const run = await prisma.iamRun.findUnique({
    where: { id: runId },
    include: { company: true },
  });
  if (!run) notFound();

  const rows = await prisma.recommendation.findMany({
    where: {
      iamRunId: runId,
      lifecycleState: {
        in: [
          "Assignment Pending",
          "Awaiting Acceptance",
          "Active",
          "Paused",
          "Escalated",
          "Approved",
        ],
      },
      assignments: {
        some: {
          active: true,
          OR: [{ primaryOwnerName: ownerFilter }, { primaryOwnerUserId: ownerFilter }],
        },
      },
    },
    include: { assignments: { where: { active: true }, take: 1 } },
    orderBy: { updatedAt: "desc" },
  });

  const items: BoardRecommendation[] = rows.map((r) => {
    const a = r.assignments[0];
    return {
      id: r.id,
      title: r.title,
      recommendationType: r.recommendationType,
      skuOrItemId: r.skuOrItemId,
      lifecycleState: r.lifecycleState,
      presentationCategory: r.presentationCategory,
      presentationRank: r.presentationRank,
      generationPath: r.generationPath,
      sourceModule: r.sourceModule,
      confidence: r.confidence,
      priorityScore: r.priorityScore,
      scoringProfileId: r.scoringProfileId,
      estimatedFinancialImpact: r.estimatedFinancialImpact,
      estimatedCashImpact: r.estimatedCashImpact,
      costOfInaction: r.costOfInaction,
      explainabilityJson: r.explainabilityJson,
      ownerUserId: a?.primaryOwnerUserId ?? null,
      ownerName: a?.primaryOwnerName ?? null,
      ownerAccepted: a?.accepted ?? false,
    };
  });

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <Link href="/" style={{ fontSize: 13, color: "var(--muted)" }}>
        ← All runs
      </Link>

      <header style={{ marginTop: 8 }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
          Functional Owner Queue
        </p>
        <h1 style={{ fontSize: 26, margin: "4px 0" }}>{run.runName}</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Showing recommendations for: <strong>{ownerFilter}</strong> (query{" "}
          <code>?owner=</code>)
        </p>
      </header>

      <IamRunNav runId={runId} active="assigned" />

      <AssignedRecommendationsPanel runId={runId} items={items} ownerFilter={ownerFilter} />
    </main>
  );
}
