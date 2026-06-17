import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ActionDetailPanel } from "@/components/ActionDetailPanel";
import { IamRunNav } from "@/components/IamRunNav";
import { recommendPlaybook } from "@/lib/iam/playbooks";
import { filterNotesForView } from "@/lib/iam/notes";
import { shortDate, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ActionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string; actionId: string }>;
  searchParams: Promise<{ viewAs?: string }>;
}) {
  const { runId, actionId } = await params;
  const { viewAs: viewAsParam } = await searchParams;
  const viewAs = viewAsParam === "owner" ? "owner" : "management";

  const action = await prisma.action.findFirst({
    where: { id: actionId, iamRunId: runId },
    include: {
      candidate: true,
      groupedItems: true,
      notes: { orderBy: { createdDate: "desc" } },
      run: { include: { company: true } },
    },
  });

  if (!action) notFound();

  const timeline = await prisma.changeLog.findMany({
    where: { iamRunId: runId, entityId: actionId },
    orderBy: { changedAt: "desc" },
    take: 20,
  });

  let detail: Record<string, unknown> = {};
  try {
    detail = action.detailJson ? (JSON.parse(action.detailJson) as Record<string, unknown>) : {};
  } catch {
    detail = {};
  }

  const playbook = recommendPlaybook({
    actionType: action.actionType,
    detail,
    serviceOperationalRisk: Boolean(detail.serviceRisk ?? action.candidate?.serviceOperationalRisk),
  });

  const visibleNotes = filterNotesForView(action.notes, viewAs);

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px" }}>
      <Link href={`/runs/${runId}`} style={{ fontSize: 13, color: "var(--muted)" }}>
        ← Management dashboard
      </Link>

      <IamRunNav runId={runId} active="dashboard" />

      <header style={{ marginTop: 12 }}>
        {action.featuredSlot != null && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--accent)", textTransform: "uppercase", letterSpacing: 1 }}>
            Featured priority #{action.featuredSlot}
          </p>
        )}
        {action.managementPriorityFlag && (
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--warn)" }}>Management-priority item</p>
        )}
        <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>{action.actionTitle}</h1>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>
          {action.run.company.name} · {action.run.runName}
        </p>
      </header>

      <section
        style={{
          marginTop: 20,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "14px 18px",
        }}
      >
        <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>Recommended playbook</h2>
        <strong>{playbook.playbookName}</strong>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "8px 0 0" }}>{playbook.whyChosen}</p>
        {playbook.followUpRequired && (
          <p style={{ fontSize: 12, color: "var(--warn)", margin: "8px 0 0" }}>
            Follow-up measurement required after action completes.
          </p>
        )}
      </section>

      <section style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Info label="Workflow state" value={action.workflowState} />
        <Info label="Action type" value={action.actionType} />
        <Info label="Strength" value={action.actionStrength} />
        <Info label="Priority score" value={action.priorityScore.toFixed(1)} />
        <Info label="Est. cash impact" value={usd(action.originalEstimatedImpact)} />
        <Info label="Confidence" value={action.confidenceLevel} />
        <Info label="SKU / item" value={action.skuOrItemId ?? "—"} />
        <Info label="Owner" value={action.ownerName ?? action.ownerRole ?? "Unassigned"} />
        {action.candidate && (
          <>
            <Info label="Readiness" value={action.candidate.readinessLabel} />
            <Info label="Evidence" value={action.candidate.evidenceStrength} />
          </>
        )}
      </section>

      {visibleNotes.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16 }}>Notes</h2>
          {visibleNotes.map((n) => (
            <div
              key={n.id}
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 12,
                marginTop: 8,
                fontSize: 13,
              }}
            >
              <div style={{ color: "var(--muted)", fontSize: 11 }}>{n.noteType} · {n.visibilityClass}</div>
              <div style={{ marginTop: 4 }}>{n.noteText}</div>
            </div>
          ))}
        </section>
      )}

      {timeline.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16 }}>State history</h2>
          <ul style={{ fontSize: 13, color: "var(--muted)" }}>
            {timeline.map((t) => (
              <li key={t.id}>
                {shortDate(t.changedAt)} — {t.action}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ActionDetailPanel
        actionId={action.id}
        runId={runId}
        workflowState={action.workflowState}
        ownerRole={action.ownerRole}
        ownerName={action.ownerName}
        viewAs={viewAs}
        groupedItems={action.groupedItems}
      />

      {(action.dueDate || action.reviewDate || action.firstSurfacedDate) && (
        <section style={{ marginTop: 8, fontSize: 13, color: "var(--muted)" }}>
          {action.firstSurfacedDate && <div>First surfaced: {shortDate(action.firstSurfacedDate)}</div>}
          {action.dueDate && <div>Due: {shortDate(action.dueDate)}</div>}
          {action.reviewDate && <div>Review: {shortDate(action.reviewDate)}</div>}
        </section>
      )}
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 14 }}>{value}</div>
    </div>
  );
}
