import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { IamRunNav } from "@/components/IamRunNav";
import { shortDate, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ArchiveViewPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  const run = await prisma.iamRun.findUnique({
    where: { id: runId },
    include: { company: true },
  });
  if (!run) notFound();

  const [completed, archived] = await Promise.all([
    prisma.action.findMany({
      where: { iamRunId: runId, workflowState: "Completed" },
      orderBy: { completedDate: "desc" },
    }),
    prisma.actionHistoryArchive.findMany({
      where: { iamRunId: runId },
      orderBy: { archivedDate: "desc" },
    }),
  ]);

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <Link href="/" style={{ fontSize: 13, color: "var(--muted)" }}>
        ← All runs
      </Link>

      <header style={{ marginTop: 8 }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
          Completed Archive View
        </p>
        <h1 style={{ fontSize: 26, margin: "4px 0" }}>{run.runName}</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Useful history only — archived actions never reopen. Similar issues get new action IDs.
        </p>
      </header>

      <IamRunNav runId={runId} active="archive" />

      <p style={{ marginTop: 16, fontSize: 13 }}>
        <a href={`/api/runs/${runId}/export?type=archive`} style={{ color: "var(--accent)" }}>
          Download archive export (CSV)
        </a>
      </p>

      {completed.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18 }}>Recently completed</h2>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Briefly visible before archive transition.</p>
          <ArchiveList
            items={completed.map((a) => ({
              id: a.id,
              title: a.actionTitle,
              type: a.actionType,
              owner: a.ownerName ?? a.ownerRole,
              surfaced: a.firstSurfacedDate,
              completed: a.completedDate,
              impact: a.originalEstimatedImpact,
            }))}
            runId={runId}
          />
        </section>
      )}

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 18 }}>Archived history ({archived.length})</h2>
        {archived.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>No archived actions yet.</p>
        ) : (
          <ArchiveList
            items={archived.map((a) => ({
              id: a.actionId,
              title: a.actionTitle,
              type: a.actionType,
              owner: a.ownerRoleOrUser,
              surfaced: a.firstSurfacedDate,
              completed: a.completedDate,
              archived: a.archivedDate,
              impact: a.originalEstimatedImpact,
            }))}
            runId={runId}
          />
        )}
      </section>
    </main>
  );
}

function ArchiveList({
  items,
  runId,
}: {
  runId: string;
  items: {
    id: string;
    title: string;
    type: string;
    owner: string | null;
    surfaced: Date | null;
    completed?: Date | null;
    archived?: Date;
    impact: number | null;
  }[];
}) {
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
      {items.map((a) => (
        <div
          key={a.id}
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "12px 16px",
            fontSize: 13,
          }}
        >
          <strong>{a.title}</strong>
          <div style={{ color: "var(--muted)", marginTop: 4 }}>
            {a.type} · {a.owner ?? "—"} · {usd(a.impact)}
            {a.surfaced && ` · Surfaced ${shortDate(a.surfaced)}`}
            {a.completed && ` · Completed ${shortDate(a.completed)}`}
            {a.archived && ` · Archived ${shortDate(a.archived)}`}
          </div>
          <Link href={`/runs/${runId}/actions/${a.id}?viewAs=management`} style={{ color: "var(--accent)", fontSize: 12 }}>
            View record (read-only)
          </Link>
        </div>
      ))}
    </div>
  );
}
