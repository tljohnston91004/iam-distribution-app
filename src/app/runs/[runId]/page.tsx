import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { RunWorkspace } from "@/components/RunWorkspace";
import { IamRunNav } from "@/components/IamRunNav";
import { buildRunBanners, nextBestAction } from "@/lib/iam/banners";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RunWorkspacePage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const run = await prisma.iamRun.findUnique({
    where: { id: runId },
    include: {
      company: true,
      actions: { orderBy: { priorityScore: "desc" } },
      actionCandidates: { orderBy: { rankedPosition: "asc" }, take: 20 },
      dataGaps: true,
      moduleSignals: { orderBy: { createdAt: "desc" }, take: 10 },
      _count: { select: { inventorySnapshots: true, demandHistory: true, incomingSupply: true } },
    },
  });

  if (!run) notFound();

  const featured = run.actions.filter((a) => a.featuredSlot != null && a.featuredSlot <= 2);
  const holdovers = run.actions.filter((a) => a.workflowState === "Holdover");
  const managementPriority = run.actions.filter((a) => a.managementPriorityFlag);
  const active = run.actions.filter((a) => a.workflowState === "Active");
  const awaiting = run.actions.filter((a) => a.workflowState === "Awaiting Acceptance");
  const lowConfFeatured = featured.filter(
    (a) => a.confidenceLevel.includes("Low") || a.confidenceLevel.includes("Insufficient")
  );

  const banners = buildRunBanners({
    readinessStatus: run.readinessStatus,
    holdoverCount: holdovers.length,
    dataGapCount: run.dataGaps.length,
    awaitingAcceptanceCount: awaiting.length,
    lowConfidenceFeaturedCount: lowConfFeatured.length,
  });

  const nextAction = nextBestAction({
    featuredCount: featured.length,
    holdoverCount: holdovers.length,
    activeCount: active.length,
  });

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
      <Link href="/" style={{ fontSize: 13, color: "var(--muted)" }}>
        ← All runs
      </Link>

      <header style={{ marginTop: 8, display: "flex", justifyContent: "space-between", gap: 16 }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
            Management Dashboard
          </p>
          <h1 style={{ fontSize: 26, margin: "4px 0" }}>{run.runName}</h1>
          <p style={{ color: "var(--muted)", margin: 0 }}>
            {run.company.name} · {shortDate(run.reviewWeekStart)} → {shortDate(run.reviewWeekEnd)}
          </p>
        </div>
        <div style={{ textAlign: "right", fontSize: 13, color: "var(--muted)" }}>
          <div>Run: {run.runStatus}</div>
          <div>Cycle: {run.cycleStatus}</div>
          <div>Readiness: {run.readinessStatus}</div>
        </div>
      </header>

      <IamRunNav runId={runId} active="dashboard" />

      <RunWorkspace
        run={{
          ...run,
          reviewWeekStart: run.reviewWeekStart.toISOString(),
          reviewWeekEnd: run.reviewWeekEnd.toISOString(),
        }}
        banners={banners}
        nextAction={nextAction}
        holdovers={holdovers}
        managementPriority={managementPriority}
      />
    </main>
  );
}
