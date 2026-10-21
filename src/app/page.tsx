import Link from "next/link";
import { prisma } from "@/lib/db";
import { shortDate } from "@/lib/format";
import { pageGate } from "@/lib/dpos/page-gate";
import { boundIamCompanyId } from "@/lib/dpos/runtime";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const gate = await pageGate();
  if (gate) return gate;
  // DPOS_INTEGRATED: only the bound company's review cycles; STANDALONE_LEGACY: unchanged (all).
  const boundCompanyId = await boundIamCompanyId();
  const runs = await prisma.iamRun.findMany({
    ...(boundCompanyId ? { where: { companyId: boundCompanyId } } : {}),
    orderBy: { createdAt: "desc" },
    include: {
      company: true,
      _count: { select: { recommendations: true, dataGaps: true } },
    },
  });

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 24px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <p style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, fontSize: 12, margin: 0 }}>
            Decision Priority · IAM Version 1.5
          </p>
          <h1 style={{ fontSize: 30, margin: "6px 0" }}>Inventory Action Manager</h1>
          <p style={{ color: "var(--muted)", maxWidth: 640, margin: 0 }}>
            Weekly Decision Board for Active Priorities, capacity (OEC), Waiting, WIP, and Deferred —
            what to commit this week, who owns it, and what waits.
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
              color: "#fff",
              borderRadius: 8,
              padding: "9px 16px",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            + New Review Cycle
          </Link>
        </div>
      </header>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 18 }}>Review Cycles · Decision Boards</h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
          Open a cycle to use the Decision Board (Summary, OEC, Active Priorities, and management actions).
        </p>

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
            No Review Cycles yet. Create one to upload Keystroke evidence, score Recommendations, and open the
            Decision Board.
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
                  <span style={{ color: "var(--muted)" }}>Recommendations</span>
                  <div>{run._count.recommendations}</div>
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
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--accent)" }}>Open Decision Board →</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
