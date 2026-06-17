import Link from "next/link";
import { prisma } from "@/lib/db";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const runs = await prisma.iamRun.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      company: true,
      _count: { select: { actions: true, dataGaps: true } },
    },
  });

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 24px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <p style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, fontSize: 12, margin: 0 }}>
            DPOS-Distribution · V1.0
          </p>
          <h1 style={{ fontSize: 30, margin: "6px 0" }}>Inventory Action Manager</h1>
          <p style={{ color: "var(--muted)", maxWidth: 620, margin: 0 }}>
            What inventory action matters most now, who owns it, and how do we keep current work
            and completed history clearly separated? Sibling to RSE and IFM.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          <Link
            href="/validation"
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "9px 16px",
              fontWeight: 500,
              whiteSpace: "nowrap",
              fontSize: 13,
            }}
          >
            Validation / UAT
          </Link>
          <Link
            href="/runs/new"
            style={{
              background: "var(--accent)",
              color: "#04122a",
              borderRadius: 8,
              padding: "9px 16px",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            + New IAM Run
          </Link>
        </div>
      </header>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 18 }}>Weekly action runs</h2>

        {runs.length === 0 ? (
          <div
            style={{
              marginTop: 12,
              border: "1px dashed var(--border)",
              borderRadius: 12,
              padding: 32,
              textAlign: "center",
              color: "var(--muted)",
            }}
          >
            No runs yet. Create a weekly IAM run to begin upload, scoring, and action-queue review.
          </div>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {runs.map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1fr 0.8fr 0.8fr",
                  gap: 12,
                  alignItems: "center",
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "14px 18px",
                  color: "var(--text)",
                }}
              >
                <div>
                  <strong>{run.runName}</strong>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>{run.company.name}</div>
                </div>
                <div style={{ color: "var(--muted)", fontSize: 13 }}>
                  {shortDate(run.reviewWeekStart)} → {shortDate(run.reviewWeekEnd)}
                </div>
                <div style={{ fontSize: 13 }}>
                  <span style={{ color: "var(--muted)" }}>Actions</span>
                  <div>{run._count.actions}</div>
                </div>
                <div style={{ fontSize: 13, textAlign: "right" }}>
                  <span
                    style={{
                      background: "var(--panel-2)",
                      border: "1px solid var(--border)",
                      borderRadius: 999,
                      padding: "3px 10px",
                      fontSize: 12,
                      color: "var(--muted)",
                    }}
                  >
                    {run.runStatus}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
