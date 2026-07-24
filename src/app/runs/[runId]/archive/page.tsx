import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { IamRunNav } from "@/components/IamRunNav";
import { usd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ArchivePage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await prisma.iamRun.findUnique({
    where: { id: runId },
    include: { company: true },
  });
  if (!run) notFound();

  const archived = await prisma.recommendation.findMany({
    where: {
      iamRunId: runId,
      OR: [
        { presentationCategory: { in: ["completed_presentation", "archived_history"] } },
        { lifecycleState: "Archived" },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <Link href="/" style={{ fontSize: 13, color: "var(--muted)" }}>
        ← All runs
      </Link>

      <header style={{ marginTop: 8 }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
          Archive / History
        </p>
        <h1 style={{ fontSize: 26, margin: "4px 0" }}>{run.runName}</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Completed presentation, archived history, and Archived lifecycle recommendations
        </p>
      </header>

      <IamRunNav runId={runId} active="archive" />

      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        {archived.length === 0 && (
          <p style={{ color: "var(--muted)" }}>No archived or completed-presentation recommendations yet.</p>
        )}
        {archived.map((r) => (
          <article
            key={r.id}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 16,
            }}
          >
            <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>{r.title}</h3>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              {r.lifecycleState} · {r.presentationCategory} · Score {r.priorityScore?.toFixed(1) ?? "—"} · Cash{" "}
              {r.estimatedCashImpact != null ? usd(r.estimatedCashImpact) : "—"}
            </p>
            <Link
              href={`/runs/${runId}/recommendations/${r.id}`}
              style={{ fontSize: 13, display: "inline-block", marginTop: 8 }}
            >
              View history →
            </Link>
          </article>
        ))}
      </div>
    </main>
  );
}
