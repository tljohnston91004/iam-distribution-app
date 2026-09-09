import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { DecisionBoard } from "@/components/DecisionBoard";
import { IamRunNav } from "@/components/IamRunNav";
import { buildRunBanners, nextBestAction } from "@/lib/iam/banners";
import { loadBoardRecommendations, loadBusinessHealth } from "@/lib/iam/board/load";
import { shortDate } from "@/lib/format";
import type { BoardPersona } from "@/lib/iam/board/types";

export const dynamic = "force-dynamic";

export default async function DecisionBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ viewAs?: string }>;
}) {
  const { runId } = await params;
  const { viewAs } = await searchParams;
  const persona: BoardPersona =
    viewAs === "operations" || viewAs === "owner" || viewAs === "executive" ? viewAs : "executive";

  const run = await prisma.iamRun.findUnique({
    where: { id: runId },
    include: {
      company: true,
      dataGaps: true,
      _count: { select: { inventorySnapshots: true, demandHistory: true, incomingSupply: true } },
    },
  });
  if (!run) notFound();

  const recommendations = await loadBoardRecommendations(runId);
  const health = await loadBusinessHealth(runId);
  if (!health) notFound();

  const { measureOecConsumption } = await import("@/lib/iam/presentation/oec");
  const oecMeasure = await measureOecConsumption(runId);

  const active = recommendations.filter(
    (r) => r.presentationCategory === "active_priority" || r.presentationCategory === "top_2"
  );
  const holdover = recommendations.filter((r) => r.presentationCategory === "holdover");
  const awaiting = recommendations.filter((r) => r.lifecycleState === "Awaiting Acceptance");
  const lowConfTop = active.filter(
    (r) => r.confidence.toLowerCase().includes("low") || r.confidence.toLowerCase().includes("insufficient")
  );
  const activeLs = recommendations.filter((r) => r.lifecycleState === "Active");

  const banners = buildRunBanners({
    readinessStatus: run.readinessStatus,
    holdoverCount: holdover.length,
    dataGapCount: run.dataGaps.length,
    awaitingAcceptanceCount: awaiting.length,
    lowConfidenceFeaturedCount: lowConfTop.length,
  });

  const deferredCount = recommendations.filter((r) => r.presentationCategory === "deferred").length;
  if (deferredCount > 0) {
    banners.push({
      level: "info",
      message: `${deferredCount} Deferred recommendation(s) are visible in Deferred and do not compete for Active Priorities or consume OEC.`,
    });
  }

  const nextAction = nextBestAction({
    featuredCount: active.length,
    holdoverCount: holdover.length,
    activeCount: activeLs.length,
  });

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
      <Link href="/" style={{ fontSize: 13, color: "var(--muted)" }}>
        ← All runs
      </Link>

      <header style={{ marginTop: 8, display: "flex", justifyContent: "space-between", gap: 16 }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
            Decision Board
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

      <IamRunNav runId={runId} companyId={run.companyId} active="dashboard" />

      <DecisionBoard
        runId={runId}
        recommendations={recommendations}
        health={health}
        banners={banners}
        nextAction={nextAction}
        initialPersona={persona}
        evidenceCounts={run._count}
        oecConsumed={oecMeasure.consumed}
      />
    </main>
  );
}
