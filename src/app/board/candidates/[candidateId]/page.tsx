import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, type FieldSpec } from "@/components/board/client";
import { Badge, Crumbs, DL, Empty, LinkButton, Pending, Section, day, money, pct, td, th, when } from "@/components/board/ui";
import { prisma } from "@/lib/db";
import { boardSession, loadPlan } from "@/lib/dpos/board/server";
import { readRecurrenceContext } from "@/lib/dpos/closeout";
import { readWorkflowView, ACTION_STATUS_LABELS, type ActionStatus } from "@/lib/dpos/workflow";

export const dynamic = "force-dynamic";

export default async function CandidatePage({ params }: { params: Promise<{ candidateId: string }> }) {
  const s = await boardSession();
  if (!s.ok) return s.element;
  const { candidateId } = await params;
  const p = await loadPlan(s.session, candidateId);
  if (!p) notFound();
  const view = await readWorkflowView(prisma, s.session.ctx, candidateId);
  const w = (iso: string | null | undefined) => when(iso, s.session.ctx.companyTimeZone);
  const mgmt = ["OWNER", "ADMINISTRATOR", "MANAGER"].includes(s.session.actor.role);
  const rel = p.permissions.relation;
  const ownerOrManager = mgmt || rel === "PRIMARY_OWNER";
  const writer = mgmt || rel === "PRIMARY_OWNER" || rel === "AUTHORIZED_CONTRIBUTOR";
  const wf = p.workflowState;
  const status = view.actionTracking?.actionStatus ?? "NOT_STARTED";
  const pendingPause = view.pauseRequests.find((r) => r.status === "REQUESTED");
  const open = view.decisionRequired.filter((d) => d.status === "OPEN");
  const recurrence = await readRecurrenceContext(prisma, candidateId);
  const showCloseout = wf === "COMPLETED_HISTORY" || view.closedAt !== null;

  const approveFields: FieldSpec[] = [
    { name: "planSummary", label: "Management plan (what will be done)", type: "textarea", required: true, defaultValue: p.systemRecommendation.direction },
    { name: "responsibleDepartment", label: "Responsible department", required: true },
    { name: "taskOwnerId", label: "Task owner (stable DPOS user id)", help: "Use the user id, not a name or email address. Leave blank to assign the owner later." },
    { name: "taskOwnerName", label: "Task owner display name (optional)" },
    { name: "targetStart", label: "Start date", type: "date" },
    { name: "targetResolution", label: "Resolution date", type: "date" },
    { name: "baselineExposure", label: "Baseline exposure (to measure condition reduction)", type: "number" },
    { name: "exposureUnit", label: "Exposure unit", defaultValue: "USD" },
    { name: "deviatesFromRecommendation", label: "This plan deviates from the system recommendation", type: "checkbox" },
    { name: "deviationReason", label: "Deviation reason (required when it deviates)" },
    { name: "reason", label: "Decision note (optional)", type: "textarea" },
  ];

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "28px 24px 60px" }} data-testid="candidate-page">
      <Crumbs items={[{ label: "Decision Board", href: "/board" }, { label: p.title }]} />
      <header style={{ marginBottom: 16 }}>
        <p style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, fontSize: 12, margin: 0 }}>Management detail</p>
        <h1 style={{ fontSize: 26, margin: "4px 0 8px" }}>{p.title}</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Badge tone="info">{p.workflowStateLabel}</Badge>
          {p.scoring.score !== null ? <Badge>Score {p.scoring.score} · {p.scoring.band}{p.scoring.displayedRank ? ` · rank ${p.scoring.displayedRank}` : ""}</Badge> : <Badge tone="warn">Not yet scored</Badge>}
          <Pending pending={p.pending} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <LinkButton href="/board">Back to Decision Board</LinkButton>
          <LinkButton href={p.links.plan}>View Recommended Action Plan</LinkButton>
          <LinkButton href={p.links.evidence}>View evidence ({p.condition.evidenceCount})</LinkButton>
          {showCloseout ? <LinkButton href={`/board/candidates/${p.candidateId}/closeout`}>Formal closeout</LinkButton> : null}
        </div>
      </header>

      <Section id="summary" title="Summary">
        <DL
          rows={[
            ["Condition", p.condition.statement ?? p.condition.summary ?? "Not stated"],
            ["System recommendation", p.systemRecommendation.direction],
            ["Management plan", p.managementPlan ? `v${p.managementPlan.planVersion}: ${p.managementPlan.summary}` : "Not approved yet"],
            ["Department / owner", `${p.ownership.department ?? "Unassigned"} / ${p.ownership.ownerName ?? p.ownership.ownerId ?? "Unassigned"}`],
            ["Action status", ACTION_STATUS_LABELS[status as ActionStatus] ?? status],
            ["Action completion", p.execution.actionCompletionPct === null ? "Not reported" : `${p.execution.actionCompletionPct}%`],
            ["Condition reduction", pct(p.execution.conditionReductionPct)],
            ["Remaining exposure", p.execution.remainingExposure === null ? "Not recorded" : money(p.execution.remainingExposure, p.execution.exposureUnit)],
            ["Target", `${p.dates.start ?? "n/a"} to ${p.dates.resolution ?? "n/a"}`],
          ]}
        />
      </Section>

      {recurrence.isRecurrence && recurrence.prior ? (
        <Section id="recurrence" title="Recurrence of an earlier condition" subtitle={recurrence.statement}>
          <div data-testid="recurrence-context">
            <p style={{ margin: "0 0 6px", fontSize: 14 }}>
              Recurrence #{recurrence.recurrenceSequence}: the condition returned after{" "}
              <Link href={`/board/candidates/${recurrence.prior.candidateId}/closeout`}>{recurrence.prior.title ?? recurrence.prior.candidateId}</Link> was closed as {recurrence.prior.finalResolutionLabel ?? "n/a"}.
            </p>
            <DL
              rows={[
                ["Prior action", recurrence.prior.actionSummary ?? "n/a"],
                ["Prior plan", recurrence.prior.planSummary ?? "n/a"],
                ["Prior condition reduction", pct(recurrence.prior.conditionReductionPct)],
                ["Prior lessons", recurrence.prior.lessons ? [recurrence.prior.lessons.whatWorked, recurrence.prior.lessons.whatDidNotWork, recurrence.prior.lessons.futureHandling].filter(Boolean).join(" · ") || "None" : "None recorded"],
              ]}
            />
          </div>
        </Section>
      ) : null}

      {open.length ? (
        <Section id="decision-required" title="Decision required">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {open.map((d) => (
              <li key={d.flagId}>
                {d.reasonCode.replaceAll("_", " ").toLowerCase()} · raised {w(d.raisedAt.toISOString())}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section id="actions" title="Actions you can take" subtitle={p.permissions.reason ?? "Each action is a governed workflow step. It is recorded with your user id, and the board shows exactly what happened."}>
        {wf === "NEW_CANDIDATE" && mgmt ? <ActionForm candidateId={p.candidateId} action="present" title="Present for management decision" submitLabel="Present for decision" busyLabel="Presenting…" fields={[]} intro="Moves this candidate from New Candidate to Presented so management can decide." /> : null}
        {["PRESENTED", "ESCALATED"].includes(wf) && mgmt ? (
          <>
            <ActionForm candidateId={p.candidateId} action="approve" title="Approve with a management plan" submitLabel="Approve" busyLabel="Approving…" fields={approveFields} />
            <ActionForm candidateId={p.candidateId} action="reject" title="Reject" submitLabel="Reject" busyLabel="Rejecting…" fields={[{ name: "reason", label: "Rejection reason", type: "textarea", required: true }]} />
            <ActionForm candidateId={p.candidateId} action="riskAccept" title="Accept the risk" submitLabel="Accept risk" busyLabel="Saving…" fields={[{ name: "reason", label: "Reason for accepting the risk", type: "textarea", required: true }]} />
            <ActionForm candidateId={p.candidateId} action="escalate" title="Escalate" submitLabel="Escalate" busyLabel="Escalating…" fields={[{ name: "escalatedTo", label: "Escalate to (stable user id or group)", required: true }, { name: "reason", label: "Reason", type: "textarea", required: true }]} />
            {wf === "PRESENTED" ? <ActionForm candidateId={p.candidateId} action="returnForReview" title="Return for review" submitLabel="Return for review" busyLabel="Returning…" fields={[{ name: "reason", label: "Review note", type: "textarea", required: true }]} /> : null}
          </>
        ) : null}
        {wf === "PENDING_OWNER_ACCEPTANCE" && rel === "PRIMARY_OWNER" ? <ActionForm candidateId={p.candidateId} action="acceptOwnership" title="Accept ownership" submitLabel="Accept ownership" busyLabel="Accepting…" fields={[{ name: "note", label: "Note (optional)" }]} /> : null}
        {wf === "ACTIVE_ACTION" && status === "NOT_STARTED" && ownerOrManager ? <ActionForm candidateId={p.candidateId} action="startAction" title="Start the action" submitLabel="Start action" busyLabel="Starting…" fields={[{ name: "note", label: "Note (optional)" }]} /> : null}
        {wf === "ACTIVE_ACTION" && status !== "NOT_STARTED" && writer ? (
          <>
            <ActionForm
              candidateId={p.candidateId}
              action="updateProgress"
              title="Update progress"
              submitLabel="Save progress"
              busyLabel="Saving…"
              fields={[
                { name: "actionCompletionPct", label: "Action completion %", type: "number" },
                { name: "nextMilestone", label: "Next milestone" },
                { name: "nextMilestoneDue", label: "Milestone due", type: "date" },
                { name: "note", label: "Note" },
              ]}
              intro="Action completion is how much of the work is done. It is separate from how much the condition has been reduced."
            />
            <ActionForm
              candidateId={p.candidateId}
              action="updateConditionReduction"
              title="Record exposure (condition reduction)"
              submitLabel="Save exposure"
              busyLabel="Saving…"
              fields={[
                { name: "baselineExposure", label: "Baseline exposure", type: "number" },
                { name: "currentExposure", label: "Current exposure", type: "number" },
                { name: "exposureUnit", label: "Unit", defaultValue: p.metric.unit ?? "USD" },
                { name: "note", label: "Note" },
              ]}
            />
          </>
        ) : null}
        {wf === "ACTIVE_ACTION" && ownerOrManager && status !== "COMPLETED" && status !== "NOT_STARTED" ? (
          <>
            <ActionForm candidateId={p.candidateId} action="raiseBlocker" title="Raise a blocker" submitLabel="Raise blocker" busyLabel="Raising…" fields={[{ name: "reason", label: "What is blocking the action", type: "textarea", required: true }, { name: "dependency", label: "Dependency (optional)" }, { name: "material", label: "Material (needs a management decision)", type: "checkbox" }]} />
            <ActionForm candidateId={p.candidateId} action="requestPause" title="Request a pause" submitLabel="Request pause" busyLabel="Requesting…" fields={[{ name: "reason", label: "Why a pause is needed", type: "textarea", required: true }, { name: "expectedDurationDays", label: "Expected duration (days)", type: "number" }, { name: "reactivationCondition", label: "What restarts the action" }]} />
            <ActionForm candidateId={p.candidateId} action="completeAction" title="Mark the action complete" submitLabel="Mark complete" busyLabel="Completing…" fields={[{ name: "note", label: "Completion note" }]} />
          </>
        ) : null}
        {pendingPause && mgmt ? (
          <ActionForm
            candidateId={p.candidateId}
            action="decidePause"
            title={`Decide the pause request from ${pendingPause.requestedBy}`}
            submitLabel="Record decision"
            busyLabel="Saving…"
            defaultOpen
            intro={`Reason given: ${pendingPause.reason}`}
            fields={[{ name: "decision", label: "Decision", type: "select", required: true, options: [{ value: "APPROVE", label: "Approve the pause" }, { value: "DENY", label: "Deny the pause" }] }, { name: "reason", label: "Decision reason", type: "textarea", required: true }]}
          />
        ) : null}
        {!["NEW_CANDIDATE", "PRESENTED", "ESCALATED", "PENDING_OWNER_ACCEPTANCE", "ACTIVE_ACTION"].includes(wf) || (wf === "NEW_CANDIDATE" && !mgmt) || (["PRESENTED", "ESCALATED"].includes(wf) && !mgmt) ? (
          <Empty>No action is available to you for this candidate in its current state.</Empty>
        ) : null}
      </Section>

      <Section id="history" title="Decision and status history">
        {view.managementDecisions.length === 0 && view.actionStatusHistory.length === 0 ? (
          <Empty>No decisions or status changes yet.</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["When", "Who", "What", "Why"].map((c) => (
                  <th key={c} style={th}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ...view.managementDecisions.map((d) => ({ at: d.decidedAt, who: d.actorId, what: `Decision: ${d.decisionType.replaceAll("_", " ").toLowerCase()}${d.planVersion ? ` (plan v${d.planVersion})` : ""}`, why: d.reason ?? "" })),
                ...view.actionStatusHistory.map((h) => ({ at: h.at, who: h.actorId, what: `Status: ${h.fromStatus ?? "none"} to ${h.toStatus}`, why: h.trigger })),
              ]
                .sort((a, b) => b.at.getTime() - a.at.getTime())
                .map((r, i) => (
                  <tr key={i}>
                    <td style={td}>{w(r.at.toISOString())}</td>
                    <td style={td}>{r.who}</td>
                    <td style={td}>{r.what}</td>
                    <td style={td}>{r.why}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Section>

      <p style={{ fontSize: 13 }}>
        <Link href="/board">Back to the Decision Board</Link> · Target dates {day(p.dates.start)} to {day(p.dates.resolution)}
      </p>
    </main>
  );
}
