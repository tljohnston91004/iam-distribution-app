import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { IamRunNav } from "@/components/IamRunNav";
import { AssignedActionsPanel } from "@/components/AssignedActionsPanel";

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

  const actions = await prisma.action.findMany({
    where: {
      iamRunId: runId,
      OR: [{ ownerName: ownerFilter }, { ownerRole: ownerFilter }],
      workflowState: { in: ["Awaiting Acceptance", "Active", "Holdover", "Paused", "Approved"] },
    },
    orderBy: { dueDate: "asc" },
  });

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <Link href="/" style={{ fontSize: 13, color: "var(--muted)" }}>
        ← All runs
      </Link>

      <header style={{ marginTop: 8 }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
          Assigned User View
        </p>
        <h1 style={{ fontSize: 26, margin: "4px 0" }}>{run.runName}</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Showing actions for: <strong>{ownerFilter}</strong>
        </p>
      </header>

      <IamRunNav runId={runId} active="assigned" />

      <AssignedActionsPanel
        runId={runId}
        actions={actions.map((a) => ({
          id: a.id,
          actionTitle: a.actionTitle,
          workflowState: a.workflowState,
          dueDate: a.dueDate?.toISOString() ?? null,
          reviewDate: a.reviewDate?.toISOString() ?? null,
          actionType: a.actionType,
        }))}
        ownerFilter={ownerFilter}
      />
    </main>
  );
}
