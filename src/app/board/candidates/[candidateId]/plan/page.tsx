import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/board/client";
import { Badge, Crumbs, DL, Empty, LinkButton, Pending, Section, day, money, pct, td, th, when } from "@/components/board/ui";
import { boardSession, loadPlan } from "@/lib/dpos/board/server";
import type { PlanAction } from "@/lib/dpos/board";

export const dynamic = "force-dynamic";

const FEAS_TONE = { CONFIRMED_FEASIBLE: "good", LIKELY_FEASIBLE: "info", REQUIRES_VERIFICATION: "warn", NOT_FEASIBLE: "bad" } as const;

function Actions({ items }: { items: PlanAction[] }) {
  if (!items.length) return <Empty>None stated.</Empty>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
      {items.map((a, i) => (
        <li key={i}>
          <strong>{a.title}</strong>
          {a.department ? ` (${a.department})` : ""}
          {a.detail ? <div style={{ color: "var(--muted)" }}>{a.detail}</div> : null}
        </li>
      ))}
    </ul>
  );
}

function List({ items, none }: { items: string[]; none: string }) {
  if (!items.length) return <Empty>{none}</Empty>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

export default async function PlanPage({ params }: { params: Promise<{ candidateId: string }> }) {
  const s = await boardSession();
  if (!s.ok) return s.element;
  const { candidateId } = await params;
  const p = await loadPlan(s.session, candidateId);
  if (!p) notFound();
  const perm = p.permissions;
  const w = (iso: string | null | undefined) => when(iso, s.session.ctx.companyTimeZone);

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "28px 24px 60px" }} data-testid="plan-page">
      <Crumbs items={[{ label: "Decision Board", href: "/board" }, { label: p.title, href: p.links.detail }, { label: "Recommended Action Plan" }]} />
      <header style={{ marginBottom: 16 }}>
        <p style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, fontSize: 12, margin: 0 }}>Recommended Action Plan</p>
        <h1 style={{ fontSize: 26, margin: "4px 0 8px" }}>{p.title}</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Badge tone="info">{p.workflowStateLabel}</Badge>
          {p.scoring.score !== null ? <Badge>Score {p.scoring.score} · {p.scoring.band}</Badge> : <Badge tone="warn">Not yet scored</Badge>}
          <Badge tone={FEAS_TONE[p.feasibility.level]}>{p.feasibility.label}</Badge>
          <Pending pending={p.pending} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <LinkButton href="/board">Back to Decision Board</LinkButton>
          <LinkButton href={p.links.detail}>Management detail</LinkButton>
          <LinkButton href={p.links.evidence}>View evidence ({p.condition.evidenceCount})</LinkButton>
        </div>
      </header>

      <Section id="condition" title="Condition and objective">
        <DL
          rows={[
            ["Condition", p.condition.statement ?? p.condition.summary ?? "Not stated"],
            ["Objective", p.objective ?? "Not stated (see verification questions)"],
            ["Metric", p.metric.name ?? "Not stated"],
            ["Baseline", `${p.metric.baseline === null ? "Not supplied" : money(p.metric.baseline, p.metric.unit)} · ${p.metric.baselineSource}`],
            ["Target", p.metric.target === null ? "Not supplied" : money(p.metric.target, p.metric.unit)],
            ["Direction", p.metric.direction ?? "Not stated"],
          ]}
        />
      </Section>

      <Section id="actions" title="Actions">
        <h3 style={{ fontSize: 14, margin: "0 0 4px" }}>Primary action</h3>
        {p.actions.primary ? (
          <p style={{ margin: "0 0 12px", fontSize: 14 }}>
            <strong>{p.actions.primary.title}</strong>
            {p.actions.primary.detail ? ` — ${p.actions.primary.detail}` : ""}
          </p>
        ) : (
          <Empty>No primary action has been stated.</Empty>
        )}
        <h3 style={{ fontSize: 14, margin: "12px 0 4px" }}>Supporting actions</h3>
        <Actions items={p.actions.supporting} />
        <h3 style={{ fontSize: 14, margin: "12px 0 4px" }}>Alternative actions</h3>
        <Actions items={p.actions.alternative} />
        <h3 style={{ fontSize: 14, margin: "12px 0 4px" }}>Escalation actions</h3>
        <Actions items={p.actions.escalation} />
        <h3 style={{ fontSize: 14, margin: "12px 0 4px" }}>Not recommended</h3>
        {p.actions.notRecommended.length ? (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {p.actions.notRecommended.map((n, i) => (
              <li key={i}>
                {n.title}
                {n.reason ? <span style={{ color: "var(--muted)" }}> — {n.reason}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>None stated.</Empty>
        )}
      </Section>

      <Section id="ownership" title="Timing and ownership">
        <DL
          rows={[
            ["Start", p.dates.start ?? "Not set"],
            ["Resolution", p.dates.resolution ?? "Not set"],
            ["Department", p.ownership.department ?? "Not assigned"],
            ["Owner", p.ownership.ownerName ?? p.ownership.ownerId ?? "Not assigned"],
            ["Contributors", p.ownership.contributors.length ? p.ownership.contributors.map((c) => c.displayName ?? c.userId).join(", ") : "None"],
            ["Contributors needed", p.ownership.contributorsNeeded.length ? p.ownership.contributorsNeeded.join(", ") : "None stated"],
          ]}
        />
      </Section>

      <Section id="assumptions" title="Dependencies, constraints and assumptions">
        <h3 style={{ fontSize: 14, margin: "0 0 4px" }}>Dependencies</h3>
        <List items={p.dependencies} none="None stated." />
        <h3 style={{ fontSize: 14, margin: "12px 0 4px" }}>Constraints</h3>
        <List items={p.constraints} none="None stated." />
        <h3 style={{ fontSize: 14, margin: "12px 0 4px" }}>Assumptions</h3>
        <List items={p.assumptions} none="None stated." />
      </Section>

      <Section id="feasibility" title="Feasibility, confidence and expected impact">
        <DL
          rows={[
            ["Feasibility", <Badge key="f" tone={FEAS_TONE[p.feasibility.level]}>{p.feasibility.label}</Badge>],
            ["Basis", p.feasibility.assumed ? "Feasibility has not been stated, so it is shown as Requires Verification. It is never assumed." : (p.feasibility.basis ?? "Not stated")],
            ["Confidence", p.confidence ?? "Not stated"],
            ["Expected impact", p.expectedImpact?.description ? `${p.expectedImpact.description}${p.expectedImpact.amount !== null ? ` (${money(p.expectedImpact.amount, p.expectedImpact.unit)})` : ""}` : "Not stated. No impact is estimated here."],
          ]}
        />
      </Section>

      <Section id="coi" title="Cost of inaction (COI)" subtitle={`Horizon: ${p.coi.horizonDays} days (${p.coi.horizonBasis === "TARGET_RESOLUTION" ? "to the target resolution date" : "default"}). Pilot carrying rate ${(p.coi.carryingRate * 100).toFixed(0)}% a year.`}>
        <p style={{ margin: "0 0 8px" }}>
          <Badge tone={p.coi.status === "COMPLETE" ? "good" : p.coi.status === "PARTIAL" ? "warn" : "neutral"}>{p.coi.status === "NOT_COMPUTABLE" ? "Not computable" : p.coi.status === "PARTIAL" ? "Partial: carrying cost only" : "Complete"}</Badge>
        </p>
        <DL
          rows={[
            ["Excess exposure", p.coi.grossExcessValue === null ? "Not supplied" : money(p.coi.grossExcessValue)],
            ["Protected by natural sell-through", money(p.coi.protectedByNaturalSellThrough)],
            ["Residual exposure", p.coi.residualExcessValue === null ? "Not computable" : money(p.coi.residualExcessValue)],
            ["Carrying cost over the horizon", p.coi.carryingCost === null ? "Not computable" : money(p.coi.carryingCost)],
            ["Expected preventable loss", p.coi.expectedPreventableLossSupported ? money(p.coi.expectedPreventableLoss) : "Not supported by evidence, so not added"],
            ["Excess COI", p.coi.total === null ? "Not computable" : money(p.coi.total)],
          ]}
        />
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 0 }}>{p.coi.statement}</p>
      </Section>

      <Section id="recommendation" title="System recommendation and management-approved plan" subtitle="The system recommendation is never overwritten. A change to the plan is a new version; earlier versions are kept.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12 }}>
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }} data-testid="system-recommendation">
            <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>System recommendation (version {p.systemRecommendation.version})</h3>
            <p style={{ margin: 0, fontSize: 14 }}>{p.systemRecommendation.direction}</p>
            {p.systemRecommendation.summary ? <p style={{ color: "var(--muted)", fontSize: 13 }}>{p.systemRecommendation.summary}</p> : null}
            <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 0 }}>Recommended {w(p.systemRecommendation.recommendedAt)} by {p.systemRecommendation.recommendedBy}</p>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }} data-testid="management-plan">
            <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>Management-approved plan {p.managementPlan ? `(version ${p.managementPlan.planVersion})` : ""}</h3>
            {p.managementPlan ? (
              <>
                <p style={{ margin: 0, fontSize: 14 }}>{p.managementPlan.summary}</p>
                {p.managementPlan.deviatesFromRecommendation ? (
                  <p style={{ fontSize: 13 }}>
                    <Badge tone="warn">Deviates from the recommendation</Badge> {p.managementPlan.deviationReason}
                  </p>
                ) : (
                  <p style={{ fontSize: 13, color: "var(--muted)" }}>Follows the system recommendation.</p>
                )}
                <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 0 }}>Approved {w(p.managementPlan.approvedAt)} by {p.managementPlan.approver ?? "n/a"}</p>
              </>
            ) : (
              <Empty>Management has not approved a plan yet.</Empty>
            )}
          </div>
        </div>
        <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>Plan version history</h3>
        {p.versions.length === 0 ? (
          <Empty>No plan versions.</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="plan-versions">
            <thead>
              <tr>
                {["Version", "State", "Summary", "Deviation", "Created by", "Created"].map((c) => (
                  <th key={c} style={th}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.versions.map((v) => (
                <tr key={v.planVersion}>
                  <td style={td}>
                    v{v.planVersion} {v.current ? <Badge tone="good">Current</Badge> : <Badge>Superseded</Badge>}
                  </td>
                  <td style={td}>{v.state}</td>
                  <td style={td}>{v.summary}</td>
                  <td style={td}>{v.deviatesFromRecommendation ? v.deviationReason ?? "Yes" : "None"}</td>
                  <td style={td}>{v.createdBy}</td>
                  <td style={td}>{w(v.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {p.revisions.length ? (
          <>
            <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>Plan revisions</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {p.revisions.map((r, i) => (
                <li key={i}>
                  {w(r.at)}: plan {r.planVersionBefore ? `v${r.planVersionBefore} to ` : "to "}v{r.planVersionAfter} by {r.actorId}. Reason: {r.reason ?? "not recorded"}.
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Section>

      <Section id="execution" title="Execution state" subtitle="Action completion and condition reduction are different measures and are never combined.">
        <DL
          rows={[
            ["Action status", p.execution.actionStatusLabel],
            ["Action completion", p.execution.actionCompletionPct === null ? "Not reported" : `${p.execution.actionCompletionPct}%`],
            ["Condition reduction", pct(p.execution.conditionReductionPct)],
            ["Remaining exposure", p.execution.remainingExposure === null ? "Not recorded" : money(p.execution.remainingExposure, p.execution.exposureUnit)],
          ]}
        />
      </Section>

      <Section id="verification" title="Verification questions" subtitle="Anything the records do not supply is a question to answer, not something to assume.">
        {p.verificationQuestions.length === 0 ? (
          <Empty>Nothing is outstanding.</Empty>
        ) : (
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14 }} data-testid="verification-questions">
            {p.verificationQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        )}
      </Section>

      <Section id="revise" title="Revise the plan" subtitle={perm.canRevisePlan ? "Creates a new plan version, keeps the earlier one and the system recommendation, and records who changed it and why." : (perm.reason ?? "The plan cannot be revised in its current state.")}>
        {perm.canRevisePlan ? (
          <ActionForm
            candidateId={p.candidateId}
            action="revisePlan"
            title="Revise plan (new version)"
            submitLabel="Save new plan version"
            busyLabel="Saving…"
            fields={[
              { name: "planSummary", label: "New plan summary", type: "textarea", required: true },
              { name: "reason", label: "Reason for the revision", type: "textarea", required: true },
              { name: "deviatesFromRecommendation", label: "This plan deviates from the system recommendation", type: "checkbox" },
              { name: "deviationReason", label: "Deviation reason (required when it deviates)", type: "text" },
            ]}
          />
        ) : (
          <Empty>{perm.reason ?? "Plan revision is available while the action is approved or active."}</Empty>
        )}
      </Section>

      <Section id="evidence" title="Evidence">
        <p style={{ margin: 0 }}>
          {p.evidence.length} evidence item{p.evidence.length === 1 ? "" : "s"}. <Link href={p.links.evidence}>Open the evidence list</Link>
        </p>
        <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 0 }}>Plan dates: start {day(p.dates.start)}, resolution {day(p.dates.resolution)}.</p>
      </Section>
    </main>
  );
}
