import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, type FieldSpec } from "@/components/board/client";
import { Badge, Crumbs, DL, Empty, LinkButton, Section, day, money, pct, td, th, when } from "@/components/board/ui";
import { boardSession, loadCloseout } from "@/lib/dpos/board/server";
import {
  ATTRIBUTION_CATEGORIES,
  ATTRIBUTION_EVIDENCE_KINDS,
  ATTRIBUTION_LABELS,
  FINAL_RESOLUTION_STATUSES,
  IMPACT_LABELS,
  IMPACT_MEASURES,
  CONDITION_FAMILIES,
  MANAGEMENT_RESPONSES,
  MANAGEMENT_RESPONSE_LABELS,
  OUTCOME_CONFIDENCES,
  RECURRENCE_RISKS,
  RESOLUTION_LABELS,
  RESOLUTION_STATUSES,
  EXPECTED_KEYS,
  type ResolutionStatus,
} from "@/lib/dpos/closeout";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "good" | "info" | "warn" | "bad" | "neutral"> = {
  FULLY_RESOLVED: "good",
  SUBSTANTIALLY_RESOLVED: "good",
  PARTIALLY_RESOLVED: "warn",
  CONTROLLED_BUT_CONTINUING: "warn",
  IMPROVING: "info",
  ON_TARGET: "info",
  NOT_YET_MEASURED: "neutral",
  UNSUCCESSFUL: "bad",
  NO_LONGER_APPLICABLE: "neutral",
};
const label = (s: string | null | undefined) => (s ? (RESOLUTION_LABELS[s as ResolutionStatus] ?? s) : "n/a");
const opt = (xs: readonly string[], labels?: Record<string, string>) => xs.map((x) => ({ value: x, label: labels?.[x] ?? x.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }));

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

export default async function CloseoutPage({ params }: { params: Promise<{ candidateId: string }> }) {
  const s = await boardSession();
  if (!s.ok) return s.element;
  const { candidateId } = await params;
  const c = await loadCloseout(s.session, candidateId);
  if (!c) notFound();
  const tz = s.session.ctx.companyTimeZone;
  const w = (iso: string | null | undefined) => when(iso, tz);
  const v = c.latest;
  const sx = v ?? c.liveContext;
  const p = c.permissions;
  const ex = c.execution;

  const measureFields: FieldSpec[] = [
    ...(v ? ([{ name: "revisionReason", label: "Why this new version (the earlier version is preserved)", type: "textarea", required: true }] as FieldSpec[]) : []),
    { name: "baselineExposure", label: "Baseline exposure", type: "number", help: `Leave blank to use the recorded action baseline${ex.baselineExposure !== null ? ` (${money(ex.baselineExposure, ex.exposureUnit)})` : " (none was recorded: the outcome then cannot be measured)"}. A different baseline needs a reason.` },
    { name: "baselineChangeReason", label: "Reason for a different baseline" },
    { name: "finalExposure", label: "Final measured exposure", type: "number", help: `Leave blank when the outcome cannot be measured yet. The last exposure recorded during execution was ${ex.currentExposure === null ? "not recorded" : money(ex.currentExposure, ex.exposureUnit)}.` },
    { name: "exposureUnit", label: "Unit", defaultValue: ex.exposureUnit ?? "USD" },
    { name: "measurementStart", label: "Measurement period start", type: "date" },
    { name: "measurementEnd", label: "Measurement period end", type: "date" },
    { name: "evidenceCurrentThrough", label: "Evidence current through", type: "date", help: "The evidence must be current through the end of the period for the outcome to be final." },
    { name: "evidenceRefs", label: "Evidence references (one per line)", type: "textarea", help: "A measurement with no evidence reference has Insufficient confidence." },
    { name: "residualType", label: "Residual exposure type", placeholder: "e.g. OPEN_PO_VALUE" },
    { name: "residualValue", label: "Residual exposure value", type: "number" },
    { name: "residualUnit", label: "Residual exposure unit", placeholder: "USD" },
    { name: "residualType2", label: "Second residual type (never summed with the first)" },
    { name: "residualValue2", label: "Second residual value", type: "number" },
    { name: "residualUnit2", label: "Second residual unit" },
    { name: "assessedStatus", label: "Resolution status", type: "select", options: [{ value: "", label: "Use the system recommendation (if there is one)" }, ...opt(RESOLUTION_STATUSES, RESOLUTION_LABELS)], help: "Where the data defines a result the system recommends it. Otherwise management states the status and a rationale: no percentage threshold is invented." },
    { name: "assessmentRationale", label: "Rationale for the status", type: "textarea" },
    { name: "outcomeConfidence", label: "Outcome confidence", type: "select", options: [{ value: "", label: "Default from the evidence" }, ...opt(OUTCOME_CONFIDENCES)] },
    { name: "outcomeConfidenceRationale", label: "Confidence rationale" },
    { name: "attributionCategory", label: "Attribution (separate from the outcome)", type: "select", required: true, options: opt(ATTRIBUTION_CATEGORIES, ATTRIBUTION_LABELS), help: "Never inferred from timing alone. Use Unclear / Insufficient Evidence when the evidence cannot support more." },
    { name: "attributionRationale", label: "Attribution rationale", type: "textarea", required: true },
    { name: "attributionConfidence", label: "Attribution confidence", type: "select", options: [{ value: "", label: "Default for the category" }, ...opt(["HIGH", "MODERATE", "LOW", "NOT_MEASURABLE"])] },
    ...["1", "2", "3"].flatMap((i): FieldSpec[] => [
      { name: `attributionEvidenceKind${i}`, label: `Attribution evidence ${i}: kind`, type: "select", options: [{ value: "", label: "(none)" }, ...opt(ATTRIBUTION_EVIDENCE_KINDS)] },
      { name: `attributionEvidenceRef${i}`, label: `Attribution evidence ${i}: reference` },
      { name: `attributionEvidenceNote${i}`, label: `Attribution evidence ${i}: note` },
    ]),
    { name: "attributionAlternatives", label: "Alternative explanations considered (one per line)", type: "textarea" },
    ...EXPECTED_KEYS.flatMap((k): FieldSpec[] => [
      { name: `expected_${k}_value`, label: `Expected ${k} (optional)`, type: "number" },
      { name: `expected_${k}_unit`, label: `Expected ${k} unit` },
    ]),
    ...IMPACT_MEASURES.flatMap((m): FieldSpec[] => [
      { name: `actual_${m}_value`, label: `Actual ${IMPACT_LABELS[m]} (evidenced only)`, type: "number" },
      { name: `actual_${m}_unit`, label: `Actual ${IMPACT_LABELS[m]} unit` },
      { name: `actual_${m}_evidence`, label: `Actual ${IMPACT_LABELS[m]} evidence reference`, help: "An actual is never recorded without evidence." },
    ]),
    { name: "expectedTargetDate", label: "Expected resolution date", type: "date" },
    { name: "actualResolvedDate", label: "Actual resolution date", type: "date" },
    { name: "actualResolvedEvidenceRef", label: "Actual resolution evidence reference" },
    { name: "recurrenceRisk", label: "Recurrence risk", type: "select", options: [{ value: "", label: "Default" }, ...opt(RECURRENCE_RISKS)] },
    { name: "recurrenceRiskRationale", label: "Recurrence risk rationale" },
    { name: "followUpRecommendation", label: "Follow-up recommendation", type: "textarea" },
    { name: "dataLimitations", label: "Data limitations (one per line)", type: "textarea" },
    { name: "notYetMeasuredReason", label: "If not yet measurable: why", type: "textarea" },
    { name: "nextMeasurementDate", label: "Next measurement date", type: "date", help: "Required for Not Yet Measured, Improving and On Target." },
    { name: "requiredEvidence", label: "Evidence still required (one per line)", type: "textarea" },
  ];

  const finalOptions = FINAL_RESOLUTION_STATUSES.map((x) => ({ value: x, label: RESOLUTION_LABELS[x as ResolutionStatus] }));

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "28px 24px 60px" }} data-testid="closeout-page">
      <Crumbs items={[{ label: "Decision Board", href: "/board" }, { label: c.title ?? "Candidate", href: `/board/candidates/${c.candidateId}` }, { label: "Formal closeout" }]} />
      <header style={{ marginBottom: 16 }}>
        <p style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, fontSize: 12, margin: 0 }}>Formal closeout · outcome · attribution · learning</p>
        <h1 style={{ fontSize: 26, margin: "4px 0 8px" }}>{c.title ?? "Candidate"}</h1>
        <p data-testid="condition-family" style={{ color: "var(--muted)", margin: "0 0 8px", fontSize: 13 }}>
          Condition family: <strong>{c.conditionFamily ? c.conditionFamily.label : c.learning ? c.learning.conditionFamilyLabel : "Not yet classified"}</strong>
          {c.conditionDetail ? <> · Condition detail: {c.conditionDetail}</> : null}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Badge tone={c.closed ? "good" : "info"}>
            <span data-testid="closeout-board-label">{c.boardLabel}</span>
          </Badge>
          <Badge>Execution complete: {ex.completedAt ? "Yes" : "No"}</Badge>
          <Badge tone={c.closed ? "good" : "warn"}>Closeout complete: {c.closed ? "Yes" : "No"}</Badge>
          {c.recurrence.isRecurrence ? <Badge tone="warn">Recurrence #{c.recurrence.recurrenceSequence}</Badge> : null}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <LinkButton href="/board">Back to Decision Board</LinkButton>
          <LinkButton href={`/board/candidates/${c.candidateId}`}>Candidate detail</LinkButton>
          <LinkButton href="/board/learning">Learning and effectiveness</LinkButton>
        </div>
      </header>

      {c.closed ? (
        <p data-testid="closed-notice" style={{ background: "var(--ryg-green-bg)", color: "var(--good)", borderRadius: 8, padding: "10px 14px", fontSize: 14 }}>
          Permanently closed {w(c.closedAt)} as <strong>{c.closeout?.finalResolutionLabel}</strong>. This record is immutable and the candidate is never reopened; if the condition returns it becomes a new candidate linked to this one.
        </p>
      ) : null}

      <Section id="gate" title="Closeout status" subtitle="The permanent close requires every item below (and is the last step).">
        {!c.closeout ? <Empty>{p.reason ?? "Formal closeout has not been started."}</Empty> : null}
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }} data-testid="gate-items">
          {c.gate.items.map((g) => (
            <li key={g.key} style={{ color: g.met ? "var(--good)" : "var(--text)" }}>
              {g.met ? "Done" : "Open"} · {g.label} <span style={{ color: "var(--muted)" }}>({g.detail})</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="execution" title="Execution summary" subtitle="How the work went. This is separate from whether the condition was resolved.">
        <DL
          rows={[
            ["Action status", ex.actionStatus ?? "n/a"],
            ["Action completion", ex.actionCompletionPct === null ? "Not reported" : `${ex.actionCompletionPct}%`],
            ["Started / completed", `${w(ex.startedAt)} / ${w(ex.completedAt)}`],
            ["Target resolution", day(ex.targetResolution)],
            ["Completion validated", w(ex.completionValidatedAt)],
            ["Exposure during execution", `baseline ${ex.baselineExposure === null ? "not recorded" : money(ex.baselineExposure, ex.exposureUnit)}, last recorded ${ex.currentExposure === null ? "not recorded" : money(ex.currentExposure, ex.exposureUnit)}`],
          ]}
        />
      </Section>

      <Section id="outcome" title="Measured outcome" subtitle="Baseline, final measurement and condition reduction. Reduction = (baseline − final) ÷ baseline; it can be zero or negative and is never clamped.">
        {!v ? (
          <Empty>No outcome has been measured yet.</Empty>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <Badge tone={STATUS_TONE[v.assessed.status] ?? "neutral"}>
                <span data-testid="assessed-status">{v.assessed.label}</span>
              </Badge>
              <Badge>Version {v.closeoutVersion}{v.approved ? " · approved" : ""}</Badge>
              <Badge tone={v.outcomeConfidence.level === "HIGH" || v.outcomeConfidence.level === "MEDIUM" ? "info" : "warn"}>Outcome confidence: {v.outcomeConfidence.level}</Badge>
            </div>
            <DL
              rows={[
                ["Baseline", v.baselineExposure === null ? "Not recorded" : money(v.baselineExposure, v.exposureUnit)],
                ["Final measurement", v.finalExposure === null ? "Not measured" : money(v.finalExposure, v.exposureUnit)],
                ["Condition reduction", v.conditionReductionPct === null ? "Not measurable (no percentage is produced)" : <strong key="r" data-testid="condition-reduction">{v.conditionReductionPct}%</strong>],
                ["Measurement period", `${day(v.window.measurementStart)} to ${day(v.window.measurementEnd)} · evidence current through ${day(v.window.evidenceCurrentThrough?.slice(0, 10) ?? null)}`],
                ["Residual exposure", v.residual ? v.residual.items.map((r) => `${r.type}: ${money(r.value, r.unit)}`).join("; ") + (v.residual.items.length > 1 ? " (listed separately, never summed)" : "") : "Not recorded"],
                ["System recommendation", v.recommendation.status ? `${v.recommendation.label}` : "None: management judgement is required"],
                ["Basis", v.recommendation.basis.explanation ?? ""],
                ["Management assessment", `${v.assessed.label}${v.assessed.rationale ? ` · ${v.assessed.rationale}` : ""}`],
                ["Confidence rationale", v.outcomeConfidence.rationale ?? "n/a"],
                ["Recurrence risk", `${v.recurrenceRisk}${v.recurrenceRiskRationale ? ` · ${v.recurrenceRiskRationale}` : ""}`],
                ["Follow-up", v.followUpRecommendation ?? "None stated"],
              ]}
            />
            {v.notYetMeasured ? (
              <div data-testid="not-yet-measured" style={{ marginTop: 10, background: "var(--ryg-yellow-bg)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
                <strong>Not yet measured.</strong> {v.notYetMeasured.reason ?? ""} Next measurement: {day(v.window.nextMeasurementDate)}.
                <List items={v.notYetMeasured.requiredEvidence} none="No required evidence listed." />
              </div>
            ) : null}
            <h3 style={{ fontSize: 14, margin: "12px 0 4px" }}>Data limitations</h3>
            <List items={v.dataLimitations} none="None recorded." />
          </>
        )}
      </Section>

      <Section id="expected-actual" title="Expected vs actual" subtitle="Actual results appear only with evidence; nothing is estimated or filled in.">
        {!v?.expectedVsActual ? (
          <Empty>No expected or actual results have been recorded.</Empty>
        ) : (
          <>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Measure", "Expected", "Actual (evidenced)", "Variance", "Note"].map((x) => (
                    <th key={x} style={th}>
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {v.expectedVsActual.rows.map((r) => (
                  <tr key={r.key}>
                    <td style={td}>{r.label}</td>
                    <td style={td}>{r.expected ? money(r.expected.value, r.expected.unit) : "None"}</td>
                    <td style={td}>{r.actual ? `${money(r.actual.value, r.actual.unit)} (${r.actual.evidenceRef})` : "None recorded"}</td>
                    <td style={td}>{r.variance === null ? "n/a" : r.variance}</td>
                    <td style={td}>{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              Timeframe: expected {day(v.expectedVsActual.timeframe.expectedTargetDate)} · actual {day(v.expectedVsActual.timeframe.actualResolvedDate)} · {v.expectedVsActual.timeframe.note}
            </p>
          </>
        )}
        {sx?.coi ? (
          <div data-testid="coi-vs-actual" style={{ marginTop: 10, fontSize: 13 }}>
            <strong>Estimated cost of inaction:</strong> {sx.coi.estimatedCoi.value === null ? "not available" : money(sx.coi.estimatedCoi.value)} ({sx.coi.estimatedCoi.status}). <strong>Evidenced actual impact:</strong>{" "}
            {sx.coi.actualMeasuredImpacts.length ? sx.coi.actualMeasuredImpacts.map((a) => `${IMPACT_LABELS[a.measure as keyof typeof IMPACT_LABELS] ?? a.measure} ${money(a.value, a.unit)}`).join("; ") : "none recorded"}. <strong>Residual:</strong>{" "}
            {sx.coi.residual ? sx.coi.residual.items.map((r) => money(r.value, r.unit)).join("; ") : "not recorded"}.
            <div style={{ color: "var(--muted)" }}>{sx.coi.statement}</div>
          </div>
        ) : null}
      </Section>

      <Section id="attribution" title="Attribution" subtitle="Whether the action contributed. Stored separately from the outcome; a sequence in time is never treated as a cause.">
        {!v ? (
          <Empty>Attribution is recorded with the first measurement.</Empty>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <Badge tone={v.attribution.category.endsWith("CONTRIBUTION") && !v.attribution.category.startsWith("NEG") ? "info" : "neutral"}>
                <span data-testid="attribution-label">{v.attribution.label}</span>
              </Badge>
              <Badge>Attribution confidence: {v.attribution.confidence}</Badge>
            </div>
            <p style={{ margin: "0 0 6px", fontSize: 14 }}>{v.attribution.rationale}</p>
            <h3 style={{ fontSize: 14, margin: "8px 0 4px" }}>Evidence</h3>
            <List items={v.attribution.evidence.map((e) => `${e.kind.replaceAll("_", " ").toLowerCase()}${e.ref ? ` · ${e.ref}` : ""}${e.note ? ` · ${e.note}` : ""}`)} none="No attribution evidence recorded." />
            <h3 style={{ fontSize: 14, margin: "8px 0 4px" }}>Alternative explanations considered</h3>
            <List items={v.attribution.alternatives} none="None recorded." />
          </>
        )}
      </Section>

      <Section id="evidence" title="Evidence and observations">
        <h3 style={{ fontSize: 14, margin: "0 0 4px" }}>Evidence references</h3>
        <List items={v?.evidenceRefs ?? []} none="No evidence reference recorded yet." />
        <h3 style={{ fontSize: 14, margin: "10px 0 4px" }}>Owner and contributor observations</h3>
        {c.observations.length === 0 ? (
          <Empty>No observation recorded.</Empty>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {c.observations.map((o, i) => (
              <li key={i}>
                {w(o.at)} · {o.actorId}: {o.text}
                {o.observedValue !== null ? ` (observed ${money(o.observedValue, o.unit)})` : ""}
                {o.evidenceRef ? ` · evidence ${o.evidenceRef}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="scoring-history" title="Scoring history" subtitle={sx?.scoring?.statement ?? "Read-only: scores are shown as they were calculated, never recomputed here."}>
        {!sx?.scoring ? (
          <Empty>No scoring history.</Empty>
        ) : (
          <>
            <DL
              rows={[
                ["Initial", sx.scoring.initial ? `score ${sx.scoring.initial.domainScore ?? "n/a"} · ${sx.scoring.initial.priorityBand ?? "n/a"} · rank ${sx.scoring.initial.calculatedRank ?? "n/a"} (${w(sx.scoring.initial.at)})` : "Never scored"],
                ["Peak", sx.scoring.peak ? `score ${sx.scoring.peak.domainScore} · rank ${sx.scoring.peak.calculatedRank ?? "n/a"} (${w(sx.scoring.peak.at)})` : "n/a"],
                ["Final before closeout", sx.scoring.finalPreCloseout ? `score ${sx.scoring.finalPreCloseout.domainScore ?? "n/a"} · ${sx.scoring.finalPreCloseout.priorityBand ?? "n/a"} · rank ${sx.scoring.finalPreCloseout.displayedRank ?? sx.scoring.finalPreCloseout.calculatedRank ?? "n/a"} (${w(sx.scoring.finalPreCloseout.at)})` : "n/a"],
                ["Band movement", sx.scoring.bandMovements.length ? sx.scoring.bandMovements.map((b) => `${b.from ?? "start"} → ${b.to ?? "n/a"}`).join("; ") : "None"],
                ["Emergency reviews", sx.scoring.emergencyReviews.length ? sx.scoring.emergencyReviews.map((e) => `${e.status} (${w(e.raisedAt)})`).join("; ") : "None"],
                ["Scoring state changes sent", String(sx.scoring.scoringStateChanges.length)],
              ]}
            />
            {sx.scoring.rankHistory.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
                <thead>
                  <tr>
                    {["When", "Outcome", "Score", "Band", "Rank"].map((x) => (
                      <th key={x} style={th}>
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sx.scoring.rankHistory.map((r, i) => (
                    <tr key={i}>
                      <td style={td}>{w(r.at)}</td>
                      <td style={td}>{r.outcome}</td>
                      <td style={td}>{r.domainScore ?? "n/a"}</td>
                      <td style={td}>{r.priorityBand ?? "n/a"}</td>
                      <td style={td}>{r.displayedRank ?? r.calculatedRank ?? "n/a"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        )}
      </Section>

      <Section id="health-history" title="Health history and context" subtitle="Company-level context only.">
        {!sx?.health ? (
          <Empty>No Health history.</Empty>
        ) : (
          <>
            <p data-testid="health-provisional" style={{ background: "var(--ryg-yellow-bg)", color: "var(--warn)", borderRadius: 8, padding: "8px 12px", fontSize: 13, margin: "0 0 8px" }}>
              {sx.health.statement}
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
              {sx.health.points.map((h) => (
                <li key={h.label}>
                  {h.label.replaceAll("_", " ").toLowerCase()}: {h.score === null ? "no Health score existed" : `${h.score} (${h.healthLabel ?? "n/a"}, ${h.curveStatus ?? "n/a"}) calculated ${w(h.calculatedAt)}`}
                </li>
              ))}
            </ul>
            {sx.health.movement ? <p style={{ fontSize: 13, color: "var(--muted)" }}>{sx.health.movement.comparable ? `Health moved ${sx.health.movement.scoreChange} points between the first and last point, for reference only.` : "The Health points use different formula versions and are not compared."}</p> : null}
          </>
        )}
      </Section>

      <Section id="plan-context" title="Plan and recommendation context">
        {!sx?.plan ? (
          <Empty>No plan context.</Empty>
        ) : (
          <>
            <DL
              rows={[
                ["Approved plan", sx.plan.planVersion ? `v${sx.plan.planVersion}: ${sx.plan.summary ?? ""}` : "None"],
                ["Department / owner", `${sx.plan.department ?? "n/a"} / ${sx.plan.ownerId ?? "n/a"}`],
                ["Plan deviates from the recommendation", sx.plan.deviatesFromRecommendation ? `Yes: ${sx.plan.deviationReason ?? ""}` : "No"],
                ["Plan versions", sx.plan.versions.map((x) => `v${x.planVersion} ${x.state.toLowerCase()}`).join("; ") || "None"],
                ["Plan revisions", sx.plan.revisions.length ? sx.plan.revisions.map((r) => `v${r.planVersionBefore ?? "?"} → v${r.planVersionAfter ?? "?"} by ${r.actorId}: ${r.reason ?? ""}`).join("; ") : "None"],
              ]}
            />
          </>
        )}
      </Section>

      <Section id="approval" title="Management approval">
        {c.approvals.length === 0 ? (
          <Empty>Not yet approved by management.</Empty>
        ) : (
          <>
            {c.approval ? (
              <DL
                rows={[
                  ["Approved version", String(c.approval.closeoutVersion)],
                  ["System recommended", label(c.approval.recommendedStatus)],
                  ["Assessed", label(c.approval.assessedStatus)],
                  ["Final approved status", <strong key="f" data-testid="approved-status">{c.approval.finalLabel}</strong>],
                  ["Approved by", `${c.approval.approvedBy} (${c.approval.approvedByRole}) ${w(c.approval.approvedAt)}`],
                  ["Override reason", c.approval.overrideReason ?? "None (agreed with the system recommendation)"],
                  ["Note", c.approval.note ?? "None"],
                ]}
              />
            ) : null}
            <p style={{ fontSize: 12, color: "var(--muted)" }}>
              All approvals: {c.approvals.map((a) => `v${a.closeoutVersion} ${label(a.finalStatus)} by ${a.approvedBy}`).join("; ")}.
            </p>
          </>
        )}
      </Section>

      <Section id="lessons" title="Lessons learned" subtitle="Evidence capture only: learning never changes scoring, Health curves, RSE policy or recommendations.">
        {!c.learning ? (
          <Empty>{c.closed ? "Learning was recorded as not applicable (see the approval note)." : "No learning record yet."}</Empty>
        ) : (
          <DL
            rows={[
              ["Condition family", `${c.learning.conditionFamilyLabel} (${c.learning.conditionFamily ?? "n/a"}, ${c.learning.conditionFamilyVersion ?? "n/a"}, ${(c.learning.conditionFamilySource ?? "n/a").toLowerCase().replace(/_/g, " ")})`],
              ["Condition detail", c.learning.conditionType ?? "n/a"],
              ["Management response", c.learning.managementResponseLabel],
              ["What worked", c.learning.whatWorked ?? "n/a"],
              ["What did not work", c.learning.whatDidNotWork ?? "n/a"],
              ["Barriers", c.learning.barriers.join("; ") || "None"],
              ["Assumptions", c.learning.assumptions.map((a) => `${(a as { assumption: string }).assumption} (${(a as { held: string }).held.toLowerCase()})`).join("; ") || "None"],
              ["Dependencies", c.learning.dependencies.join("; ") || "None"],
              ["Future handling", c.learning.futureHandling ?? "n/a"],
              ["Time to result", c.learning.timeToResultDays === null ? "n/a" : `${c.learning.timeToResultDays} days`],
              ["Evidence", c.learning.evidenceRefs.join("; ") || "n/a"],
            ]}
          />
        )}
      </Section>

      <Section id="recurrence" title="Recurrence" subtitle={c.recurrence.statement}>
        {c.recurrence.isRecurrence && c.recurrence.prior ? (
          <div data-testid="recurrence-prior">
            <p style={{ margin: "0 0 6px", fontSize: 14 }}>
              This candidate is recurrence #{c.recurrence.recurrenceSequence} of an earlier condition:{" "}
              <Link href={`/board/candidates/${c.recurrence.prior.candidateId}/closeout`}>{c.recurrence.prior.title ?? c.recurrence.prior.candidateId}</Link> (closed {w(c.recurrence.prior.closedAt)} as {c.recurrence.prior.finalResolutionLabel ?? "n/a"}).
            </p>
            <DL
              rows={[
                ["Prior action / plan", `${c.recurrence.prior.actionSummary ?? "n/a"} / ${c.recurrence.prior.planSummary ?? "n/a"}`],
                ["Prior condition reduction", pct(c.recurrence.prior.conditionReductionPct)],
                ["Prior attribution", c.recurrence.prior.attributionCategory ? ATTRIBUTION_LABELS[c.recurrence.prior.attributionCategory as keyof typeof ATTRIBUTION_LABELS] : "n/a"],
                ["Prior score / rank", c.recurrence.prior.score ? `${c.recurrence.prior.score.domainScore ?? "n/a"} · ${c.recurrence.prior.score.priorityBand ?? "n/a"} · rank ${c.recurrence.prior.score.displayedRank ?? "n/a"}` : "n/a"],
                ["Prior lessons", c.recurrence.prior.lessons ? [c.recurrence.prior.lessons.whatWorked, c.recurrence.prior.lessons.whatDidNotWork, c.recurrence.prior.lessons.futureHandling].filter(Boolean).join(" · ") || "None" : "None recorded"],
              ]}
            />
          </div>
        ) : (
          <Empty>This candidate is not a recurrence of an earlier closed candidate.</Empty>
        )}
        {c.recurrence.pendingReviews > 0 ? <p style={{ fontSize: 13 }}>A possible recurrence of an earlier closed candidate awaits management review (see the Decision Board).</p> : null}
        {c.recurrencesOfThis.length ? (
          <>
            <h3 style={{ fontSize: 14, margin: "10px 0 4px" }}>Later recurrences of this condition</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }} data-testid="later-recurrences">
              {c.recurrencesOfThis.map((r) => (
                <li key={r.candidateId}>
                  <Link href={`/board/candidates/${r.candidateId}`}>{r.title ?? r.candidateId}</Link> · recurrence #{r.recurrenceSequence} · {w(r.createdAt)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Section>

      <Section id="closeout-actions" title="Closeout actions" subtitle={p.reason ?? "Each step is recorded with your user id. The task owner provides evidence and observations; only management approves and finalizes."}>
        {p.canStart ? <ActionForm candidateId={c.candidateId} action="startCloseout" title="Start formal closeout" submitLabel="Start formal closeout" busyLabel="Starting…" fields={[{ name: "note", label: "Note (optional)" }]} intro="Opens the formal review. The candidate stays open until management approves a measured outcome and completes the closeout." defaultOpen /> : null}
        {p.canObserve ? (
          <ActionForm
            candidateId={c.candidateId}
            action="recordObservation"
            title="Record an outcome observation"
            submitLabel="Save observation"
            busyLabel="Saving…"
            fields={[{ name: "observation", label: "What you observed", type: "textarea", required: true }, { name: "evidenceRef", label: "Evidence reference" }, { name: "observedValue", label: "Observed exposure (owner or manager only)", type: "number" }, { name: "unit", label: "Unit" }]}
            intro="An observation is evidence for management. It never sets the official measurement and never closes the candidate."
          />
        ) : null}
        {p.canMeasure ? <ActionForm candidateId={c.candidateId} action="recordMeasurement" title={v ? "Record a revised measurement (new version)" : "Record the outcome measurement"} submitLabel="Save measurement" busyLabel="Saving…" fields={measureFields} intro="Creates an immutable version. The system then shows its recommended resolution status; nothing is overwritten." defaultOpen={!v} /> : null}
        {p.canApprove && v ? (
          <ActionForm
            candidateId={c.candidateId}
            action="approveCloseout"
            title="Approve the closeout"
            submitLabel="Approve"
            busyLabel="Approving…"
            fields={[
              { name: "finalStatus", label: "Final resolution status", type: "select", required: true, defaultValue: v.recommendation.status && FINAL_RESOLUTION_STATUSES.includes(v.recommendation.status as never) ? v.recommendation.status : v.assessed.status, options: finalOptions },
              { name: "overrideReason", label: "Reason (required when different from the system recommendation)", type: "textarea" },
              { name: "learningNotApplicableReason", label: "Learning not applicable: reason (only if no learning record applies)" },
              { name: "note", label: "Approval note" },
            ]}
            intro={`System recommendation: ${v.recommendation.label ?? "none (management judgement)"}. Both the recommendation and your approved status are preserved.`}
            defaultOpen
          />
        ) : null}
        {p.canRecordLearning ? (
          <ActionForm
            candidateId={c.candidateId}
            action="recordLearning"
            title="Record the learning"
            submitLabel="Save learning"
            busyLabel="Saving…"
            fields={[
              { name: "conditionFamily", label: "Condition family (used only if this candidate is not classified yet)", type: "select", options: [{ value: "", label: c.conditionFamily ? `Classified: ${c.conditionFamily.label}` : "Unclassified (Other Governed Condition)" }, ...CONDITION_FAMILIES.map((f) => ({ value: f.code, label: f.label }))] },
              { name: "managementResponse", label: "Management response to the recommendation", type: "select", options: [{ value: "", label: "Derive from the decision history" }, ...opt(MANAGEMENT_RESPONSES, MANAGEMENT_RESPONSE_LABELS)] },
              { name: "whatWorked", label: "What worked", type: "textarea" },
              { name: "whatDidNotWork", label: "What did not work", type: "textarea" },
              { name: "barriers", label: "Barriers (one per line)", type: "textarea" },
              { name: "assumption1", label: "Assumption 1" },
              { name: "assumptionHeld1", label: "Assumption 1 held?", type: "select", options: opt(["TRUE", "FALSE", "UNKNOWN"]) },
              { name: "dependencies", label: "Dependencies (one per line)", type: "textarea" },
              { name: "futureHandling", label: "How to handle this in future", type: "textarea" },
              { name: "evidenceRefs", label: "Evidence supporting the lessons (one per line)", type: "textarea" },
            ]}
            intro="Evidence capture only. It never changes scoring, Health curves, RSE policy or recommendations, and a poor result never marks a management decision as wrong."
          />
        ) : null}
        {p.canComplete ? <ActionForm candidateId={c.candidateId} action="completeCloseout" title="Complete the closeout (permanent)" submitLabel="Close permanently" busyLabel="Closing…" fields={[{ name: "learningNotApplicableReason", label: "Learning not applicable: reason (only if no learning record exists)" }, { name: "note", label: "Closing note" }]} intro="Locks the candidate. It can never be reopened; a returning condition becomes a new linked candidate." defaultOpen /> : null}
        {!p.canStart && !p.canObserve && !p.canMeasure && !p.canApprove && !p.canRecordLearning && !p.canComplete ? <Empty>No closeout action is available to you for this candidate right now.</Empty> : null}
      </Section>

      <Section id="versions" title="Closeout versions and history">
        {c.versions.length === 0 ? (
          <Empty>No closeout version yet.</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
            <thead>
              <tr>
                {["Version", "Recorded", "By", "Kind", "Assessed", "Reduction", "Confidence", "Approved"].map((x) => (
                  <th key={x} style={th}>
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.versions.map((x) => (
                <tr key={x.closeoutVersion} data-testid="closeout-version-row">
                  <td style={td}>{x.closeoutVersion}</td>
                  <td style={td}>{w(x.recordedAt)}</td>
                  <td style={td}>{x.recordedBy}</td>
                  <td style={td}>{x.assessmentKind.replaceAll("_", " ").toLowerCase()}</td>
                  <td style={td}>{x.assessed.label}</td>
                  <td style={td}>{x.conditionReductionPct === null ? "n/a" : `${x.conditionReductionPct}%`}</td>
                  <td style={td}>{x.outcomeConfidence.level}</td>
                  <td style={td}>{x.approved ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["When", "Who", "What", "Why"].map((x) => (
                <th key={x} style={th}>
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...c.history].reverse().map((h, i) => (
              <tr key={i}>
                <td style={td}>{w(h.at)}</td>
                <td style={td}>{h.actorId}</td>
                <td style={td}>{h.operation.replaceAll("_", " ").toLowerCase()}{h.closeoutVersion ? ` (v${h.closeoutVersion})` : ""}</td>
                <td style={td}>{h.reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <ul style={{ fontSize: 12, color: "var(--muted)", paddingLeft: 18 }}>
        {c.statements.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </main>
  );
}
