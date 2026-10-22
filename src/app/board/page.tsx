import Link from "next/link";
import { MarkReviewed, RecalculateHealth, RefreshFromDataHub } from "@/components/board/client";
import { Badge, DL, Empty, LinkButton, Pending, Section, day, localDay, money, pct, td, th, when } from "@/components/board/ui";
import { boardSession, loadBoard } from "@/lib/dpos/board/server";

export const dynamic = "force-dynamic";

const FRESH_TONE = { CURRENT: "good", AGING: "warn", STALE: "bad", NEVER_REFRESHED: "bad", REFRESH_FAILED: "bad", SCHEDULE_UNAVAILABLE: "warn", MISSING_TIME_ZONE: "bad", INVALID_TIME_ZONE: "bad" } as const;
const LABEL_TONE: Record<string, "good" | "info" | "warn" | "bad"> = { STRONG: "good", HEALTHY: "info", WATCH: "warn", NEEDS_ATTENTION: "bad" };

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ location?: string; period?: string }> }) {
  const s = await boardSession();
  if (!s.ok) return s.element;
  const q = await searchParams;
  const b = await loadBoard(s.session, { location: q.location ?? null, period: q.period ?? null });
  const h = b.health;
  const mgmt = b.actor.isManagement;
  // Every instant is shown in the COMPANY time zone (never the server's or browser's, never a silent UTC).
  const tz = b.company.timeZoneValid ? b.company.companyTimeZone : null;
  const w = (iso: string | null | undefined) => when(iso, tz);

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 24px 60px" }} data-testid="board-v4">
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <p style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, fontSize: 12, margin: 0 }}>Decision Priority · IAM Decision Board V4</p>
          <h1 style={{ fontSize: 28, margin: "4px 0" }}>Inventory Management Decision Board</h1>
          <p style={{ color: "var(--muted)", margin: 0, fontSize: 13 }}>
            Signed in as <strong>{b.actor.actorId}</strong> ({b.actor.role}). The board reads stored records only; it never scores or refreshes by itself. Times are shown in {tz ?? "UTC (the company time zone is not available)"}.
          </p>
        </div>
        <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <LinkButton href="/runs/new">V1.5 weekly review</LinkButton>
        </nav>
      </header>

      {/* 11. Freshness and sync states + manual refresh */}
      <Section id="freshness" title="Data freshness and sync" subtitle="Scores are calculated from the data held here; a refresh brings the data up to date but never recalculates a score.">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 460px" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {b.freshness.states.map((st) => (
                <Badge key={st} tone={FRESH_TONE[st]}>
                  {st === "NEVER_REFRESHED" && b.healthTimestamps.evidenceCurrentThrough ? "No IAM refresh recorded" : st.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
                </Badge>
              ))}
              <Pending pending={b.pending} />
            </div>
            <DL
              rows={[
                ["Evidence current through (source time)", w(b.healthTimestamps.evidenceCurrentThrough)],
                ["Last Data Hub read", w(b.healthTimestamps.dataHubReadAt)],
                ["Last Health calculation", w(b.healthTimestamps.healthCalculatedAt)],
                ["Last IAM refresh", b.healthTimestamps.lastIamRefreshAt ? w(b.healthTimestamps.lastIamRefreshAt) : b.healthTimestamps.evidenceCurrentThrough ? "No IAM refresh recorded yet (Health evidence is present)" : "No IAM refresh recorded yet"],
                ["Next scheduled refresh", w(b.healthTimestamps.nextScheduledRefreshAt)],
                ["Data Hub inputs current through", w(b.freshness.dataCurrentThrough)],
                ["Company time zone", b.company.companyTimeZone ?? "Not configured"],
              ]}
            />
            {b.freshness.messages.map((m, i) => (
              <p key={i} style={{ color: "var(--muted)", fontSize: 13, margin: "8px 0 0" }}>
                {m}
              </p>
            ))}
            {b.pending.pending && b.pending.message ? (
              <p data-testid="pending-message" style={{ fontSize: 13, margin: "8px 0 0" }}>
                <strong>Pending Next Scoring Run.</strong> {b.pending.message}
              </p>
            ) : null}
          </div>
          <div style={{ flex: "0 0 auto", minWidth: 260 }}>{mgmt ? <RefreshFromDataHub /> : <Empty>Refreshing from the Data Hub needs a management role.</Empty>}</div>
        </div>
      </Section>

      {/* 10. Filters */}
      <Section id="filters" title="Filters" subtitle="Location applies to the location-tagged Customer Backorder figures only; Analysis Period selects a stored Health cycle.">
        <form method="get" style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            Location
            <select name="location" defaultValue={b.filters.location.selected ?? ""} style={{ padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 6, minWidth: 180 }}>
              <option value="">All locations</option>
              {b.filters.location.available.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            Analysis Period
            <select name="period" defaultValue={b.filters.period.selected ?? ""} style={{ padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 6, minWidth: 220 }}>
              <option value="">Latest cycle</option>
              {b.filters.period.available.map((p) => (
                <option key={p.weekStart} value={p.weekStart}>
                  Week of {p.weekStart} ({p.label ?? "n/a"}{p.score !== null ? `, ${p.score}` : ""})
                </option>
              ))}
            </select>
          </label>
          <button type="submit" style={{ background: "#0b2a5b", color: "#fff", border: "1px solid #08204a", borderRadius: 8, padding: "9px 16px", fontWeight: 600, cursor: "pointer" }}>
            Apply filters
          </button>
          {(q.location || q.period) && (
            <Link href="/board" style={{ fontSize: 13 }}>
              Clear filters
            </Link>
          )}
        </form>
        {b.filters.period.showing === "SELECTED_CYCLE_NOT_FOUND" ? <p style={{ color: "var(--bad)", fontSize: 13 }}>No stored Health cycle exists for that week.</p> : null}
        {b.filters.location.selected ? (
          <p style={{ fontSize: 13, marginBottom: 0 }}>
            {b.filters.location.selectedShortage ? (
              <>
                Customer backorder at <strong>{b.filters.location.selected}</strong>: {b.filters.location.selectedShortage.lines} lines, {money(b.filters.location.selectedShortage.value)} open value.
              </>
            ) : (
              <>No location-tagged backorder figures are stored for {b.filters.location.selected}.</>
            )}
          </p>
        ) : null}
        <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 0 }}>{b.filters.location.note}</p>
      </Section>

      {/* 1. Top Health Row */}
      <Section id="health" title="Inventory Management Health" subtitle={h.basedOn ?? "No Health Score has been calculated yet."} actions={mgmt ? <RecalculateHealth /> : undefined}>
        {h.notCalculated ? (
          <Empty>No Health Score has been calculated for this period. A manager can recalculate it once governed inputs are recorded.</Empty>
        ) : (
          <>
            <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1 }} data-testid="health-score">
                  {h.score === null ? "n/a" : h.score.toFixed(1)}
                </div>
                <div style={{ marginTop: 6 }}>{h.label ? <Badge tone={LABEL_TONE[h.current!.label ?? ""] ?? "neutral"}>{h.label}</Badge> : <Badge tone="warn">No component available</Badge>}</div>
              </div>
              <div style={{ fontSize: 14 }}>
                {h.change?.comparable ? (
                  <p style={{ margin: "0 0 4px" }}>
                    Change since prior: <strong>{h.change.scoreChange! > 0 ? "+" : ""}{h.change.scoreChange}</strong> points{h.change.labelChanged ? ` (was ${h.change.priorLabel ?? "n/a"})` : ""}
                  </p>
                ) : h.prior ? (
                  <p style={{ margin: "0 0 4px", color: "var(--muted)" }}>The prior score used a different formula version and is not compared.</p>
                ) : (
                  <p style={{ margin: "0 0 4px", color: "var(--muted)" }}>No prior calculation to compare with.</p>
                )}
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                  Calculated {w(h.current!.calculatedAt)} · data current through {w(h.current!.dataCurrentThrough)} · {h.version}
                </p>
              </div>
            </div>
            {h.curveNotice ? (
              <p data-testid="curve-notice" style={{ background: "var(--ryg-yellow-bg)", color: "var(--warn)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
                {h.curveNotice}
              </p>
            ) : null}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
              {h.components.map((c) => (
                <Link key={c.key} href={c.href} data-testid={`component-${c.key}`} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: c.available ? "var(--panel-2)" : "var(--ryg-gray-bg)", color: "var(--text)", textDecoration: "none" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{c.label} · weight {c.available ? `${c.effectiveWeight}%` : `${c.nominalWeight}% (not counted)`}</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{c.available ? c.score!.toFixed(1) : "Unavailable"}</div>
                  {c.efficiency ? (
                    <div data-testid="efficiency-status" style={{ fontSize: 12, marginTop: 2 }}>
                      Actual implied turns: <strong>{c.efficiency.inventoryTurns ?? "n/a"}</strong>
                      {c.efficiency.targetState === "CONFIGURED" ? <> · company target {c.efficiency.targetValue}</> : null}
                      <div>{c.efficiency.statusText}</div>
                    </div>
                  ) : null}
                  {c.evidence ? (
                    <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }} data-testid={`component-${c.key}-evidence`}>
                      <Badge tone={c.evidence.state === "CURRENT" ? "good" : c.evidence.state === "AGING" ? "warn" : c.evidence.state === "STALE" ? "bad" : "neutral"}>{c.evidence.label}</Badge>
                      {c.available && c.provisional ? <Badge tone="neutral">PROVISIONAL</Badge> : null}
                    </div>
                  ) : null}
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {c.available ? (c.change === null ? "No prior change" : `Change ${c.change > 0 ? "+" : ""}${c.change}`) : c.unavailableReason}
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </Section>

      {/* 2. What Changed */}
      <Section
        id="what-changed"
        title="What Changed Since Last Review"
        subtitle={
          b.whatChanged.sinceBasis === "LAST_REVIEW"
            ? `Since the board was last reviewed by ${b.whatChanged.lastReview?.reviewedBy} on ${w(b.whatChanged.since)}.`
            : b.whatChanged.sinceBasis === "START_OF_PREVIOUS_OPERATING_WEEK"
              ? `No review is on record: showing changes since the start of the previous operating week (${w(b.whatChanged.since)}).`
              : `No review is on record and the company time zone is not usable: showing the last 7 days (${w(b.whatChanged.since)}). No UTC week is assumed.`
        }
        actions={mgmt ? <MarkReviewed /> : undefined}
      >
        {b.whatChanged.empty ? (
          <Empty>{b.whatChanged.note}</Empty>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {b.whatChanged.items.map((i) => (
              <li key={i.id} style={{ marginBottom: 6, fontSize: 14 }}>
                <Link href={i.href}>{i.title}</Link> <span style={{ color: "var(--muted)" }}>· {w(i.at)}</span>
                <div style={{ color: "var(--muted)", fontSize: 13 }}>{i.detail}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 3. Position / classification / efficiency context */}
      <Section id="context" title="Inventory position, classification and efficiency" subtitle={b.context.note}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10 }}>
          {([
            ["Position and balance", b.context.position],
            ["Efficiency", b.context.efficiency],
            ["Slow / nonmoving classification", b.context.classification],
            ["Customer shortage / backorder", b.context.shortage],
          ] as const).map(([label, c]) => (
            <div key={label} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontWeight: 600 }}>{label}</div>
              {c ? (
                c.available ? (
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>
                    {c.drivers.slice(0, 3).map((d) => (
                      <li key={d.code}>{d.text}</li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 0" }}>Not available: {c.unavailableReason}</p>
                )
              ) : (
                <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 0" }}>No Health calculation yet.</p>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* 4. Top priorities */}
      <Section id="top-priorities" title="Top Inventory Management Priorities" subtitle={b.topPriorities.note}>
        {b.topPriorities.items.length === 0 ? (
          <Empty>No candidate currently qualifies for the Top 2. The list is never padded to fill a slot.</Empty>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {b.topPriorities.items.map((p) => (
              <article key={p.candidateId} data-testid={`priority-${p.rank}`} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>
                    #{p.rank} · <Link href={p.detailHref}>{p.title}</Link>
                  </h3>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Badge tone="info">Score {p.score} · {p.band}</Badge>
                    <Badge>{p.managementState}</Badge>
                    {p.emergency ? <Badge tone="bad">Emergency review</Badge> : null}
                    <Pending pending={p.pending} />
                  </div>
                </div>
                {p.why ? <p style={{ margin: "6px 0", fontSize: 14 }}>{p.why}</p> : null}
                <DL
                  rows={[
                    ["Exposure", `Inventory ${money(p.exposure.inventory)} · cash impact ${money(p.exposure.cashImpact)} · profit impact ${money(p.exposure.profitImpact)}`],
                    ["Recommended action", p.recommendedAction ?? "Not stated"],
                    ["Timeframe", p.timeframe ?? "Not stated"],
                    ["Confidence", p.confidence ?? "Not stated"],
                  ]}
                />
                <div style={{ marginTop: 10 }}>
                  <LinkButton href={p.planHref}>View Recommended Action Plan</LinkButton>
                </div>
              </article>
            ))}
          </div>
        )}
      </Section>

      {/* 5. Active Action Portfolio */}
      <Section id="portfolio" title="Active Action Portfolio" subtitle={`${b.portfolio.note} ${b.portfolio.holdoverBasis}`}>
        {b.portfolio.rows.length === 0 ? (
          <Empty>No approved action is active.</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Action", "Department", "Owner", "Target", "Completion", "Condition reduction", "Remaining exposure", "Status", "Next milestone", "Decision"].map((c) => (
                    <th key={c} style={th}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.portfolio.rows.map((r) => (
                  <tr key={r.candidateId} data-testid="portfolio-row">
                    <td style={td}>
                      <Link href={r.detailHref}>{r.title}</Link> {r.holdover ? <Badge tone="warn">Holdover</Badge> : null}
                    </td>
                    <td style={td}>{r.department ?? "Unassigned"}</td>
                    <td style={td}>{r.ownerName ?? r.ownerId ?? "Unassigned"}</td>
                    <td style={td}>{day(r.targetResolution)}</td>
                    <td style={td}>{r.actionCompletionPct === null ? "Not reported" : `${r.actionCompletionPct}%`}</td>
                    <td style={td}>{pct(r.conditionReductionPct)}</td>
                    <td style={td}>{money(r.remainingExposure, r.exposureUnit)}</td>
                    <td style={td}>
                      <Badge tone={["AT_RISK", "OVERDUE", "BLOCKED"].includes(r.statusCode) ? "bad" : r.statusCode === "ON_TRACK" ? "good" : "neutral"}>{r.status}</Badge>
                    </td>
                    <td style={td}>{r.nextMilestone ? `${r.nextMilestone}${r.nextMilestoneDue ? ` (${day(r.nextMilestoneDue)})` : ""}` : "None set"}</td>
                    <td style={td}>{r.decisionRequired ? <Badge tone="bad">Decision required</Badge> : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 6. Management decisions required */}
      <Section id="decisions" title="Management Decisions Required" subtitle="Everything that needs a management decision, with why, who owns it, the recommended decision and where to act.">
        {b.decisions.items.length === 0 ? (
          <Empty>No management decision is waiting.</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Item", "Type", "Why", "Owner", "Recommended decision", "Deadline", ""].map((c) => (
                    <th key={c} style={th}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.decisions.items.map((d) => (
                  <tr key={d.key} data-testid="decision-row">
                    <td style={td}>{d.title}</td>
                    <td style={td}>
                      <Badge tone="warn">{d.kindLabel}</Badge>
                    </td>
                    <td style={td}>{d.why}</td>
                    <td style={td}>{d.owner ?? "Unassigned"}</td>
                    <td style={td}>{d.recommendedDecision}</td>
                    <td style={td}>{d.deadline ? day(d.deadline) : "None set"}</td>
                    <td style={td}>
                      <LinkButton href={d.detailHref}>Open</LinkButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 7. Results */}
      <Section id="results" title="Results and Business Impact" subtitle={b.results.basisNotice}>
        <p style={{ marginTop: 0 }}>
          <Badge tone="warn">Preliminary · operational</Badge> Last {b.results.windowDays} days: {b.results.completedActions} completed, {b.results.measuredCompletions} measured, {b.results.awaitingMeasurement} awaiting measurement.
        </p>
        {b.results.conditionReduction.length === 0 ? (
          <Empty>No measured condition reduction yet. Realized business impact is not claimed.</Empty>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {b.results.conditionReduction.map((r) => (
              <li key={r.unit}>
                {r.actions} action{r.actions === 1 ? "" : "s"}: exposure reduced from {money(r.baselineExposure, r.unit)} to {money(r.currentExposure, r.unit)} ({r.reductionPct === null ? "n/a" : `${r.reductionPct}%`}).
              </li>
            ))}
          </ul>
        )}
        {b.results.activeExposure.length ? (
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            Exposure still under active management: {b.results.activeExposure.map((a) => `${money(a.exposure, a.unit)} (${a.actions} action${a.actions === 1 ? "" : "s"})`).join("; ")}.
          </p>
        ) : null}
        {b.results.items.length ? (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
            {b.results.items.map((i) => (
              <li key={i.candidateId}>
                <Link href={i.detailHref}>{i.title}</Link> completed {localDay(i.completedAt, tz)} · {i.measured ? `condition reduced ${i.conditionReductionPct}%` : "condition reduction not yet measured"}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {/* 8. Working well */}
      <Section id="working-well" title="What's Working Well" subtitle="Only what a stored measurement supports.">
        {b.workingWell.items.length === 0 ? (
          <Empty>{b.workingWell.note}</Empty>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {b.workingWell.items.map((x, i) => (
              <li key={i} data-testid="working-well-item">
                {x.href ? <Link href={x.href}>{x.text}</Link> : x.text} <span style={{ color: "var(--muted)" }}>Evidence: {x.evidence}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 9. Capacity */}
      <Section id="capacity" title="Active Action Capacity" subtitle={b.capacity.notice}>
        <DL
          rows={[
            ["Active programs", String(b.capacity.overall.activePrograms)],
            ["On track / attention", `${b.capacity.overall.onTrack} / ${b.capacity.overall.attention}`],
            ["At risk / overdue / blocked / paused", `${b.capacity.overall.atRisk} / ${b.capacity.overall.overdue} / ${b.capacity.overall.blocked} / ${b.capacity.overall.paused}`],
            ["Awaiting a management decision", String(b.capacity.overall.awaitingManagementDecision)],
            ["New candidates awaiting initial decision", String(b.capacity.newCandidatesAwaitingInitialDecision)],
          ]}
        />
        {Object.keys(b.capacity.byDepartment).length ? (
          <table style={{ borderCollapse: "collapse", marginTop: 10 }}>
            <thead>
              <tr>
                {["Department", "Active", "At risk", "Overdue", "Blocked"].map((c) => (
                  <th key={c} style={th}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(b.capacity.byDepartment).map(([dept, c]) => (
                <tr key={dept}>
                  <td style={td}>{dept}</td>
                  <td style={td}>{c.activePrograms}</td>
                  <td style={td}>{c.atRisk}</td>
                  <td style={td}>{c.overdue}</td>
                  <td style={td}>{c.blocked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>
    </main>
  );
}
