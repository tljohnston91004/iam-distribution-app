import { notFound } from "next/navigation";
import { Badge, Crumbs, DL, Empty, LinkButton, Section, td, th, when } from "@/components/board/ui";
import { prisma } from "@/lib/db";
import { boardSession } from "@/lib/dpos/board/server";
import { COMPONENT_KEYS, COMPONENT_LABELS, componentSources, curveDiagnostics, lastRseInputRead, listHealthHistory, type ComponentKey } from "@/lib/dpos/health";

export const dynamic = "force-dynamic";

export default async function HealthComponentPage({ params }: { params: Promise<{ component: string }> }) {
  const s = await boardSession();
  if (!s.ok) return s.element;
  const { component } = await params;
  if (!(COMPONENT_KEYS as readonly string[]).includes(component)) notFound();
  const key = component as ComponentKey;
  const history = await listHealthHistory(prisma, s.session.ctx, { limit: 12 });
  const latest = history[0] ?? null;
  const w = (iso: string | null | undefined) => when(iso, s.session.ctx.companyTimeZone);
  const c = latest?.components.find((x) => x.key === key) ?? null;
  const sources = latest ? await componentSources(prisma, latest.components, new Date()) : {};
  const src = sources[key] ?? null;
  const srcInfo = (src?.context?.source ?? null) as { sourceRunId?: string | null; resultsReturnEventId?: string; resultsReturnContract?: { id: string; version: string }; iamReadContract?: { id: string; version: string } } | null;
  const lastRead = src ? await lastRseInputRead(prisma, s.session.ctx.dposCompanyId) : null;
  const ctxAny = (src?.context ?? null) as { sourceTimes?: { rseSnapshotProducerEventAt: string | null; inventoryPositionAsOf: string | null; salesPeriodEnd: string | null }; sourceSkew?: { inventoryAsOfMinusRseSnapshotDays: number | null; salesPeriodEndMinusRseSnapshotDays: number | null; salesPeriodEndMinusInventoryAsOfDays: number | null }; provisionalRule?: { slow?: string; nonMoving?: string; provisional?: boolean }; overlapDisclosure?: { statement?: string; possibleOverlaps?: string[] } } | null;
  const sourceTimes = ctxAny?.sourceTimes ?? null;
  const skew = ctxAny?.sourceSkew ?? null;
  const det = (c?.detail ?? {}) as Record<string, unknown>;
  const turnsMeasure = Array.isArray(det.measures) ? (det.measures as Array<{ name: string; target: number }>).find((m) => m.name === "inventory turns") : undefined;
  const diag = latest ? curveDiagnostics(latest.components).components.find((d) => d.key === key) ?? null : null;

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "28px 24px 60px" }} data-testid="health-component-page">
      <Crumbs items={[{ label: "Decision Board", href: "/board" }, { label: "Inventory Management Health", href: "/board#health" }, { label: COMPONENT_LABELS[key] }]} />
      <h1 style={{ fontSize: 26, margin: "4px 0 12px" }}>{COMPONENT_LABELS[key]}</h1>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <LinkButton href="/board">Back to Decision Board</LinkButton>
        {COMPONENT_KEYS.filter((k) => k !== key).map((k) => (
          <LinkButton key={k} href={`/board/health/${k}`}>
            {COMPONENT_LABELS[k]}
          </LinkButton>
        ))}
      </div>
      {!latest || !c ? (
        <Section id="none" title="No calculation">
          <Empty>No Health Score has been calculated yet.</Empty>
        </Section>
      ) : (
        <>
          <Section id="current" title="Latest calculation" subtitle={`Calculated ${w(latest.calculatedAt)} · ${latest.healthVersion} · curves ${latest.curveStatus}`}>
            <DL
              rows={[
                ["Availability", c.available ? <Badge key="a" tone="good">Available</Badge> : <Badge key="a" tone="warn">Unavailable</Badge>],
                ["Component score", c.available ? String(c.score) : "Not counted (never scored as zero)"],
                ["Nominal weight", `${c.nominalWeight}%`],
                ["Effective weight", c.effectiveWeight === null ? "Not counted" : `${c.effectiveWeight}%`],
                ["Why unavailable", c.unavailableReason ?? "Not applicable"],
              ]}
            />
          </Section>
          {src ? (
            <Section id="source" title="Governed source and freshness" subtitle="Where this component's evidence came from. It is read from the Data Hub; IAM never reads RSE directly.">
              <DL
                rows={[
                  ["Evidence freshness", <Badge key="f" tone={src.freshness.state === "CURRENT" ? "good" : src.freshness.state === "AGING" ? "warn" : src.freshness.state === "STALE" ? "bad" : "neutral"}>{src.freshness.label}</Badge>],
                  ["Curve status", <Badge key="p" tone="neutral">{latest.curveStatus === "APPROVED" ? "Approved" : "PROVISIONAL"}</Badge>],
                  ["Evidence current through (source time)", src.asOf ? `${w(src.asOf)}${src.freshness.ageDays !== null ? ` (${src.freshness.ageDays} days old)` : ""}` : "Not available"],
                  ["RSE source run", srcInfo?.sourceRunId ?? "Not reported"],
                  ["RSE result (Results Return event)", srcInfo?.resultsReturnEventId ?? "Not reported"],
                  ["Result contract", srcInfo?.resultsReturnContract ? `${srcInfo.resultsReturnContract.id} ${srcInfo.resultsReturnContract.version}` : "Not reported"],
                  ["IAM read contract", srcInfo?.iamReadContract ? `${srcInfo.iamReadContract.id} ${srcInfo.iamReadContract.version}` : "Not reported"],
                  ["Data Hub read time (informational; not the evidence age)", lastRead ? `${w(lastRead.at)} (${lastRead.outcome === "SUCCESS" ? "succeeded" : "failed"})` : "No read recorded"],
                  ["Evidence recorded", src.recordedAt ? `${w(src.recordedAt)} (version ${src.evidenceVersion})` : "Not recorded"],
                  ["Health calculation time", w(latest.calculatedAt)],
                  ...(skew ? [["Source times", `RSE snapshot ${w(sourceTimes?.rseSnapshotProducerEventAt)} · inventory as-of ${w(sourceTimes?.inventoryPositionAsOf)} · sales period end ${w(sourceTimes?.salesPeriodEnd)}`] as [string, string], ["Source skew (diagnostic only)", `inventory vs RSE ${skew.inventoryAsOfMinusRseSnapshotDays ?? "n/a"} d · sales end vs RSE ${skew.salesPeriodEndMinusRseSnapshotDays ?? "n/a"} d · sales end vs inventory ${skew.salesPeriodEndMinusInventoryAsOfDays ?? "n/a"} d. No skew tolerance is governed; none is applied (future governance requested).`] as [string, string]] : []),
                ]}
              />
              {src.freshness.state === "STALE" ? <p style={{ color: "var(--bad)", fontSize: 13 }}>This evidence is stale. It is shown for reference, but the score it produced should not be relied on until the data is refreshed.</p> : null}
            </Section>
          ) : null}
          {key === "EFFICIENCY" ? (
            <Section id="efficiency-target" title="Efficiency target" subtitle="The turns target is governed company configuration. There is no default and no industry benchmark.">
              <DL
                rows={[
                  ["Actual implied turns (RSE)", String(det.inventoryTurns ?? "Not available")],
                  ["Target state", det.targetState === "CONFIGURED" ? "Configured" : det.targetState === "INVALID" ? "Unavailable — invalid target" : "Unavailable — target not configured"],
                  ["Configured company turns target", turnsMeasure ? String(turnsMeasure.target) : "Not configured"],
                  ["GMROI", det.gmroiStatus === "SCORED" ? "Scored" : det.gmroiStatus === "NOT_AVAILABLE_NO_GOVERNED_INPUT" ? "Not available — no reliable governed gross-profit / inventory input" : "Not Available / Not Configured (no governed GMROI target)"],
                ]}
              />
            </Section>
          ) : null}
          {key === "SLOW_NONMOVING" ? (
            <Section id="slow-rule" title="Slow / Nonmoving rule, sell-through and overlap" subtitle="The slow-moving window is PROVISIONAL. RSE class F remains the authoritative nonmoving classification.">
              <DL
                rows={[
                  ["Slow-moving rule (PROVISIONAL)", ctxAny?.provisionalRule?.slow ?? "Not available"],
                  ["Nonmoving", ctxAny?.provisionalRule?.nonMoving ?? "Not available"],
                  ["Natural sell-through source", String(det.naturalSellThroughSource ?? "NONE")],
                  ["Sell-through confidence", String(det.naturalSellThroughConfidence ?? "n/a")],
                  ["Governed RSE demand protected", String(det.governedRseProtectedValue ?? "n/a")],
                  ["Fallback (lower confidence) protected", String(det.fallbackProtectedValue ?? "n/a")],
                  ["Protected amount (total)", String(det.protectedByNaturalSellThrough ?? "n/a")],
                  ["Residual exposure", String(det.residualExposure ?? "n/a")],
                  ["Requires verification", det.requiresVerification ? "Yes — no credible demand evidence; no protection assumed" : "No"],
                  ["Overlap disclosure", ctxAny?.overlapDisclosure?.statement ?? "Not available"],
                ]}
              />
            </Section>
          ) : null}
          {src && src.context ? (
            <Section id="inputs" title="Inputs behind the score" subtitle="Governed values as received, with the provisional rule where IAM applies one.">
              <pre data-testid="component-inputs" style={{ background: "var(--panel-2)", padding: 12, borderRadius: 8, overflowX: "auto", fontSize: 12 }}>{JSON.stringify({ raw: src.context.raw ?? null, provisionalRule: src.context.provisionalRule ?? null, naturalSellThrough: src.context.naturalSellThrough ?? null, note: src.context.note ?? src.context.overlap ?? null }, null, 2)}</pre>
            </Section>
          ) : null}
          {diag ? (
            <Section id="curve" title="Curve diagnostic (PROVISIONAL)" subtitle="For Product Owner review. The curve is not changed by this page.">
              <DL
                rows={[
                  ["Raw metric", diag.rawMetric ? `${diag.rawMetric.name}: ${diag.rawMetric.value ?? "n/a"} ${diag.rawMetric.unit}` : "n/a"],
                  ["Curve", diag.curve],
                  ["Contribution to overall", diag.contributionPoints === null ? "Not counted" : `${diag.contributionPoints} points`],
                  ["Position on the curve", diag.headroomToFullScore ?? "n/a"],
                  ["Flags", diag.flags.length ? diag.flags.join(", ") : "None"],
                  ["Breakpoints", diag.breakpoints.map((b) => `${b.forScore} at ${b.rawMetric}${b.unit === "%" ? "%" : ` ${b.unit}`}`).join(" · ")],
                ]}
              />
            </Section>
          ) : null}
          <Section id="drivers" title="Drivers" subtitle="What moved this component, in plain terms.">
            {c.drivers.length === 0 ? (
              <Empty>No drivers recorded.</Empty>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                {c.drivers.map((d) => (
                  <li key={d.code}>{d.text}</li>
                ))}
              </ul>
            )}
          </Section>
          <Section id="evidence" title="Evidence and source records">
            {c.evidenceRefs.length ? (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {c.evidenceRefs.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : (
              <Empty>No evidence references.</Empty>
            )}
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer" }}>Calculation detail</summary>
              <pre style={{ background: "var(--panel-2)", padding: 12, borderRadius: 8, overflowX: "auto", fontSize: 12 }}>{JSON.stringify(c.detail, null, 2)}</pre>
            </details>
          </Section>
          <Section id="history" title="History" subtitle="Stored calculations are immutable; an old value is never reinterpreted.">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Calculated", "Week", "Component score", "Overall", "Version"].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const hc = h.components.find((x) => x.key === key);
                  return (
                    <tr key={h.healthScoreId}>
                      <td style={td}>{w(h.calculatedAt)}</td>
                      <td style={td}>{h.operatingWeekStart}</td>
                      <td style={td}>{hc?.available ? hc.score : "Unavailable"}</td>
                      <td style={td}>{h.score ?? "n/a"} {h.labelText ? `(${h.labelText})` : ""}</td>
                      <td style={td}>{h.healthVersion}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        </>
      )}
    </main>
  );
}
