import Link from "next/link";
import { Badge, Crumbs, DL, Empty, LinkButton, Section, td, th, when } from "@/components/board/ui";
import { boardSession, loadLearning } from "@/lib/dpos/board/server";
import type { EffectivenessGroup } from "@/lib/dpos/closeout";

export const dynamic = "force-dynamic";

const SEGMENTS: Array<[keyof Awaited<ReturnType<typeof loadLearning>>["segments"], string]> = [
  ["actionType", "By action type"],
  ["conditionFamily", "By condition family"],
  ["department", "By department"],
  ["category", "By category"],
  ["outcomeConfidence", "By outcome confidence"],
  ["attribution", "By attribution"],
];

const pc = (n: number | null) => (n === null ? "n/a" : `${n}%`);

function GroupTable({ rows, id }: { rows: EffectivenessGroup[]; id: string }) {
  if (!rows.length) return <Empty>No closed candidates in this view yet.</Empty>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid={id}>
        <thead>
          <tr>
            {["Group", "Closed", "Measured", "Succeeded", "Measured success", "Avg condition reduction", "Recurred", "Avg days to result", "Sample"].map((x) => (
              <th key={x} style={th}>
                {x}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.key}>
              <td style={td}>{g.label}</td>
              <td style={td}>{g.closed}</td>
              <td style={td}>{g.measured}</td>
              <td style={td}>{g.succeeded}</td>
              <td style={td}>{pc(g.measuredSuccessRatePct)}</td>
              <td style={td}>{pc(g.avgConditionReductionPct)}</td>
              <td style={td}>{g.recurred}</td>
              <td style={td}>{g.avgTimeToResultDays ?? "n/a"}</td>
              <td style={td}>{g.lowSample ? <Badge tone="warn">Low sample: for reference only</Badge> : "Adequate"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function LearningPage() {
  const s = await boardSession();
  if (!s.ok) return s.element;
  const e = await loadLearning(s.session);
  const w = (iso: string | null | undefined) => when(iso, s.session.ctx.companyTimeZone);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px 60px" }} data-testid="learning-page">
      <Crumbs items={[{ label: "Decision Board", href: "/board" }, { label: "Learning and action effectiveness" }]} />
      <header style={{ marginBottom: 16 }}>
        <p style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, fontSize: 12, margin: 0 }}>Closeout learning · descriptive only</p>
        <h1 style={{ fontSize: 26, margin: "4px 0 8px" }}>Learning and action effectiveness</h1>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }} data-testid="learning-statement">
          {e.statement}
        </p>
        <div style={{ marginTop: 12 }}>
          <LinkButton href="/board">Back to Decision Board</LinkButton>
        </div>
      </header>

      <Section id="overview" title="Overview" subtitle={`As of ${w(e.asOf)}. Counts and averages of what happened; they show no cause beyond a recorded attribution.`}>
        <DL
          rows={[
            ["Actions attempted", String(e.attemptedActions)],
            ["Actions completed", `${e.completedActions}${e.completionRatePct === null ? "" : ` (${e.completionRatePct}%)`}`],
            ["Formally closed", String(e.closedCandidates)],
            ["Measured success rate", `${pc(e.overall.measuredSuccessRatePct)} (${e.overall.succeeded} of ${e.overall.measured} measured closed candidates were Fully or Substantially Resolved)`],
            ["Average condition reduction", pc(e.overall.avgConditionReductionPct)],
            ["Recurrence", `${e.recurrence.withRecurrence} of ${e.recurrence.closedCandidates} closed candidates recurred (${pc(e.recurrence.ratePct)})`],
            ["Average time to result", e.overall.avgTimeToResultDays === null ? "n/a" : `${e.overall.avgTimeToResultDays} days`],
          ]}
        />
        {e.overall.lowSample ? <p style={{ fontSize: 13, color: "var(--warn)" }}>Only {e.overall.closed} closed candidate{e.overall.closed === 1 ? "" : "s"}: these figures are for reference, not a conclusion.</p> : null}
      </Section>

      <Section id="distribution" title="Resolution distribution">
        {e.resolutionDistribution.length === 0 ? (
          <Empty>No candidate has been formally closed yet.</Empty>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }} data-testid="resolution-distribution">
            {e.resolutionDistribution.map((d) => (
              <li key={d.status}>
                {d.label}: {d.count}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="recent" title="Recently closed actions">
        {e.recentClosed.length === 0 ? (
          <Empty>Nothing has been closed yet.</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="recent-closed">
            <thead>
              <tr>
                {["Candidate", "Closed", "Final status", "Condition reduction", "Attribution", "Confidence", "Learning"].map((x) => (
                  <th key={x} style={th}>
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {e.recentClosed.map((r) => (
                <tr key={r.candidateId}>
                  <td style={td}>
                    <Link href={`/board/candidates/${r.candidateId}/closeout`}>{r.title ?? r.candidateId}</Link>
                  </td>
                  <td style={td}>{w(r.closedAt)}</td>
                  <td style={td}>{r.finalLabel}</td>
                  <td style={td}>{pc(r.conditionReductionPct)}</td>
                  <td style={td}>{r.attributionLabel ?? "n/a"}</td>
                  <td style={td}>{r.outcomeConfidence ?? "n/a"}</td>
                  <td style={td}>{r.learningRecorded ? "Recorded" : "Not applicable"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section id="management-response" title="Recommendation vs plan vs outcome" subtitle="How management's path compared with the system recommendation, and how it turned out. A poor result never labels a decision wrong.">
        {e.managementResponses.length === 0 ? (
          <Empty>No closed candidate has recorded a management response yet.</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="management-responses">
              <thead>
                <tr>
                  {["Management response", "Closed", "Measured success", "Avg condition reduction", "Recurred"].map((x) => (
                    <th key={x} style={th}>
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {e.managementResponses.map((g) => (
                  <tr key={g.response}>
                    <td style={td}>{g.label}</td>
                    <td style={td}>{g.closed}{g.lowSample ? " (low sample)" : ""}</td>
                    <td style={td}>{pc(g.measuredSuccessRatePct)}</td>
                    <td style={td}>{pc(g.avgConditionReductionPct)}</td>
                    <td style={td}>{g.recurred}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="barriers" title="Common barriers">
        {e.commonBarriers.length === 0 ? (
          <Empty>No barriers have been recorded.</Empty>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {e.commonBarriers.map((b) => (
              <li key={b.barrier}>
                {b.barrier} ({b.count})
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="expected-actual" title="Expected vs actual">
        {e.overall.expectedVsActual.length === 0 ? (
          <Empty>No closed candidate has both an expected value and an evidenced actual result in the same unit.</Empty>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {e.overall.expectedVsActual.map((x) => (
              <li key={`${x.measure}${x.unit}`}>
                {x.measure} ({x.unit}): average variance {x.avgVariance} over {x.n} closed candidate{x.n === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {SEGMENTS.map(([key, title]) => (
        <Section key={key} id={`segment-${key}`} title={title} subtitle="Descriptive only; small groups are flagged and never read as a rule.">
          <GroupTable rows={e.segments[key]} id={`segment-table-${key}`} />
        </Section>
      ))}
    </main>
  );
}
