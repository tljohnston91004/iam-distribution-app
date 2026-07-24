"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { usd } from "@/lib/format";
import { parseExplainability, requiredActionHint, type BoardPersona } from "@/lib/iam/board/types";

type Detail = {
  id: string;
  title: string;
  recommendationType: string;
  skuOrItemId: string | null;
  lifecycleState: string;
  presentationCategory: string;
  generationPath: string;
  sourceModule: string;
  confidence: string;
  priorityScore: number | null;
  scoringProfileId: string | null;
  estimatedFinancialImpact: number | null;
  estimatedCashImpact: number | null;
  costOfInaction: number | null;
  explainabilityJson: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  ownerAccepted: boolean;
  storyWhat: string | null;
  storyWhy: string | null;
  storyWhyNow: string | null;
  storyExpectedResult: string | null;
  confidenceNarrative: string | null;
  progressNarrative: string | null;
  blockerNote: string | null;
  contributors: { userId: string; displayName: string | null }[];
  notes: { id: string; body: string; visibility: string; authoredBy: string; createdAt: string }[];
  governance: { decisionType: string; reason: string | null; performedBy: string; performedAt: string }[];
  workflow: { fromState: string | null; toState: string; performedBy: string; performedAt: string }[];
};

const btn: React.CSSProperties = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 12px",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 13,
};

export function RecommendationDetailClient({
  runId,
  detail,
  persona,
}: {
  runId: string;
  detail: Detail;
  persona: BoardPersona;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [mgmtOnly, setMgmtOnly] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showContributor, setShowContributor] = useState(false);
  const [contribId, setContribId] = useState("");
  const [contribName, setContribName] = useState("");
  const expl = parseExplainability(detail.explainabilityJson);
  const plan =
    (expl.prescribedActionPlan as Record<string, unknown> | undefined) ??
    ((expl.detail as { prescribedActionPlan?: Record<string, unknown> } | undefined)
      ?.prescribedActionPlan as Record<string, unknown> | undefined) ??
    null;
  const dataQualityWarning =
    (expl.dataQualityWarning as string | undefined) ??
    ((expl.detail as { dataQualityWarning?: string } | undefined)?.dataQualityWarning as
      | string
      | undefined) ??
    null;
  type MemberSkuRow = {
    skuOrItemId: string;
    inventoryValue?: number | null;
    recommendedAction?: string;
    prescribedActionReason?: string;
  };
  const memberSkus: MemberSkuRow[] =
    (expl.memberSkus as MemberSkuRow[] | undefined) ??
    ((expl.detail as { memberSkus?: MemberSkuRow[] } | undefined)?.memberSkus as
      | MemberSkuRow[]
      | undefined) ??
    [];

  async function addNote() {
    if (!note.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/recommendations/${detail.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: note,
          visibility: mgmtOnly && persona !== "owner" ? "management" : "shared",
          authoredBy: persona,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Note failed");
      setNote("");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Note failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmContributor() {
    if (!contribId.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/recommendations/${detail.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_contributor",
          userId: contribId,
          displayName: contribName || contribId,
          performedBy: persona,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setShowContributor(false);
      setContribId("");
      setContribName("");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 16 }}>
      <Link href={`/runs/${runId}`} style={{ fontSize: 13, color: "var(--muted)" }}>
        ← Decision Board
      </Link>

      <header>
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", textTransform: "uppercase" }}>
          Recommendation · {detail.presentationCategory} · {detail.lifecycleState}
        </p>
        <h1 style={{ fontSize: 24, margin: "4px 0" }}>{detail.title}</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          {detail.recommendationType} · {detail.sourceModule} · {detail.generationPath}
          {detail.skuOrItemId ? ` · ${detail.skuOrItemId}` : ""}
        </p>
        <p style={{ margin: "8px 0 0", color: "var(--accent)" }}>
          {requiredActionHint(detail.lifecycleState, detail.presentationCategory)}
        </p>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <Tile label="Priority score" value={detail.priorityScore?.toFixed(1) ?? "—"} />
        <Tile label="Cash" value={detail.estimatedCashImpact != null ? usd(detail.estimatedCashImpact) : "—"} />
        <Tile label="Financial" value={detail.estimatedFinancialImpact != null ? usd(detail.estimatedFinancialImpact) : "—"} />
        <Tile label="COI" value={detail.costOfInaction != null ? usd(detail.costOfInaction) : "Not available"} />
        <Tile label="Confidence" value={detail.confidence} />
        <Tile
          label="Owner"
          value={
            detail.ownerName || detail.ownerUserId
              ? `${detail.ownerName ?? detail.ownerUserId}${detail.ownerAccepted ? " ✓" : ""}`
              : "Unassigned"
          }
        />
      </section>

      {dataQualityWarning && (
        <p style={{ margin: 0, padding: 12, background: "var(--panel-2)", borderRadius: 8, color: "var(--warn)", fontSize: 13 }}>
          Data quality warning: {dataQualityWarning}
        </p>
      )}

      <section style={panel}>
        <h2 style={h2}>Prescribed Action Plan</h2>
        {!plan ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            No prescribed action plan on this Recommendation. Re-run Calculate after this release to
            generate required action content.
          </p>
        ) : (
          <div style={{ fontSize: 13, display: "grid", gap: 12 }}>
            <PlanField label="Recommended management action" value={String(plan.recommendedManagementAction ?? "")} />
            <PlanField label="Reason selected" value={String(plan.reasonSelected ?? "")} />
            <PlanList label="Immediate next steps" items={(plan.immediateNextSteps as string[]) ?? []} />
            <div>
              <strong style={{ color: "var(--muted)", fontSize: 11 }}>Affected inventory population</strong>
              <div style={{ marginTop: 4 }}>
                {String((plan.affectedPopulation as { analysisGrain?: string })?.analysisGrain ?? "—")} ·{" "}
                {String((plan.affectedPopulation as { skuCount?: number })?.skuCount ?? "—")} SKUs ·{" "}
                {(plan.affectedPopulation as { totalInventoryValue?: number })?.totalInventoryValue != null
                  ? usd(Number((plan.affectedPopulation as { totalInventoryValue: number }).totalInventoryValue))
                  : "—"}
                {(plan.affectedPopulation as { segmentType?: string })?.segmentType
                  ? ` · ${(plan.affectedPopulation as { segmentType: string }).segmentType} "${(plan.affectedPopulation as { segmentKey?: string }).segmentKey ?? ""}"`
                  : ""}
              </div>
            </div>
            <div>
              <strong style={{ color: "var(--muted)", fontSize: 11 }}>Action groups (SKU / subgroup)</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {((plan.actionGroups as { actionLabel: string; skuCount: number; excessValue: number; skus?: { skuOrItemId: string; inventoryValue: number | null; reason: string }[] }[]) ?? []).map(
                  (g) => (
                    <li key={g.actionLabel} style={{ marginBottom: 8 }}>
                      <strong>{g.actionLabel}</strong> — {g.skuCount} SKUs · {usd(g.excessValue)}
                      {g.skus && g.skus.length > 0 && (
                        <ul style={{ margin: "4px 0 0", paddingLeft: 16, color: "var(--muted)", fontSize: 12 }}>
                          {g.skus.slice(0, 25).map((s) => (
                            <li key={s.skuOrItemId}>
                              {s.skuOrItemId}
                              {s.inventoryValue != null ? ` · ${usd(s.inventoryValue)}` : ""} — {s.reason}
                            </li>
                          ))}
                          {g.skus.length > 25 && <li>…and {g.skus.length - 25} more in group</li>}
                        </ul>
                      )}
                    </li>
                  )
                )}
              </ul>
            </div>
            <PlanList label="Suggested sequence of execution" items={(plan.executionSequence as string[]) ?? []} />
            <PlanField label="Owner / responsible role" value={String(plan.ownerRole ?? "")} />
            <PlanField label="Target completion period" value={String(plan.targetCompletionPeriod ?? "")} />
            <PlanField label="Expected financial result" value={String(plan.expectedFinancialResult ?? "")} />
            <PlanField label="Expected operational result" value={String(plan.expectedOperationalResult ?? "")} />
            <PlanList label="Success measures" items={(plan.successMeasures as string[]) ?? []} />
            <PlanList label="Risks and cautions" items={(plan.risksAndCautions as string[]) ?? []} />
            <PlanList
              label="Data gaps or management decisions still required"
              items={(plan.dataGapsOrDecisionsRequired as string[]) ?? []}
            />
            <PlanList label="Alternative actions" items={(plan.alternativeActions as string[]) ?? []} />
            <PlanField label="Data confidence" value={String(plan.dataConfidence ?? "")} />
          </div>
        )}
        {memberSkus.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <strong style={{ fontSize: 13 }}>Supporting SKU prescriptions</strong>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--muted)", maxHeight: 220, overflow: "auto" }}>
              {memberSkus.slice(0, 80).map((m) => (
                <li key={m.skuOrItemId}>
                  {m.skuOrItemId}
                  {m.inventoryValue != null ? ` · ${usd(m.inventoryValue)}` : ""}
                  {m.recommendedAction ? ` · ${m.recommendedAction}` : ""}
                  {m.prescribedActionReason ? ` — ${m.prescribedActionReason}` : ""}
                </li>
              ))}
              {memberSkus.length > 80 && <li>…and {memberSkus.length - 80} more</li>}
            </ul>
          </div>
        )}
      </section>

      <section style={panel}>
        <h2 style={h2}>Trust Pyramid</h2>
        {detail.storyWhat ? (
          <div style={{ fontSize: 13, display: "grid", gap: 8 }}>
            <div><strong>What:</strong> {detail.storyWhat}</div>
            <div><strong>Why:</strong> {detail.storyWhy}</div>
            <div><strong>Why now:</strong> {detail.storyWhyNow}</div>
            <div><strong>Expected result:</strong> {detail.storyExpectedResult}</div>
            <div><strong>Confidence:</strong> {detail.confidenceNarrative ?? detail.confidence}</div>
          </div>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Run Calculate · Score · Present to generate Trust Pyramid copy.</p>
        )}
        {(detail.progressNarrative || detail.blockerNote) && (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            {detail.progressNarrative && <div>Progress: {detail.progressNarrative}</div>}
            {detail.blockerNote && <div style={{ color: "var(--warn)" }}>Blocker: {detail.blockerNote}</div>}
          </div>
        )}
      </section>

      <section style={panel}>
        <h2 style={h2}>Explainability</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          Profile: {detail.scoringProfileId ?? "—"}
        </p>
        {(() => {
          const revised = expl.revisedScore as
            | {
                ok?: boolean;
                governedFinalScore?: number;
                priorityBand?: string;
                structuredExplanation?: string[];
                exceptionMessage?: string;
                factors?: Record<string, number>;
              }
            | undefined;
          if (!revised) return null;
          if (revised.ok === false) {
            return (
              <p style={{ fontSize: 13, color: "var(--warn)" }}>
                Revised Decision Priority: calculation exception — {revised.exceptionMessage}
              </p>
            );
          }
          return (
            <div style={{ fontSize: 13, marginBottom: 12 }}>
              <div>
                <strong>Revised final score:</strong> {revised.governedFinalScore?.toFixed(2)} · band{" "}
                {revised.priorityBand}
              </div>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {(revised.structuredExplanation ?? []).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          );
        })()}
        <pre
          style={{
            margin: 0,
            fontSize: 12,
            whiteSpace: "pre-wrap",
            background: "var(--panel-2)",
            padding: 12,
            borderRadius: 8,
            overflow: "auto",
          }}
        >
          {JSON.stringify(expl.breakdown ?? expl, null, 2)}
        </pre>
      </section>

      <section style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={h2}>Contributors</h2>
          {persona !== "owner" && (
            <button type="button" style={btn} disabled={busy} onClick={() => setShowContributor(true)}>
              Add contributor
            </button>
          )}
        </div>
        {showContributor && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            <input
              placeholder="Contributor user id"
              value={contribId}
              onChange={(e) => setContribId(e.target.value)}
              style={inputStyle}
              aria-label="Contributor user id"
            />
            <input
              placeholder="Display name"
              value={contribName}
              onChange={(e) => setContribName(e.target.value)}
              style={inputStyle}
              aria-label="Display name"
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={btn} disabled={busy} onClick={confirmContributor}>
                Confirm
              </button>
              <button type="button" style={btn} onClick={() => setShowContributor(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {detail.contributors.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>No contributors yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {detail.contributors.map((c) => (
              <li key={c.userId}>
                {c.displayName ?? c.userId} <span style={{ color: "var(--muted)" }}>({c.userId})</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={panel}>
        <h2 style={h2}>Notes</h2>
        {detail.notes.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>No notes.</p>}
        {detail.notes.map((n) => (
          <div key={n.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {n.authoredBy} · {n.visibility} · {new Date(n.createdAt).toLocaleString()}
            </div>
            <div style={{ fontSize: 14 }}>{n.body}</div>
          </div>
        ))}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Add a note…"
          style={{
            width: "100%",
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text)",
            padding: 10,
            fontSize: 13,
          }}
        />
        {persona !== "owner" && (
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginTop: 8 }}>
            <input type="checkbox" checked={mgmtOnly} onChange={(e) => setMgmtOnly(e.target.checked)} />
            Management-only (hidden from Owner viewAs)
          </label>
        )}
        <button type="button" style={{ ...btn, marginTop: 8 }} disabled={busy} onClick={addNote}>
          Save note
        </button>
        {msg && <p style={{ color: "var(--bad)", fontSize: 13 }}>{msg}</p>}
      </section>

      <section style={panel}>
        <h2 style={h2}>Governance history</h2>
        {detail.governance.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>No governance decisions yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {detail.governance.map((g, i) => (
              <li key={i}>
                <strong>{g.decisionType}</strong>
                {g.reason ? ` — ${g.reason}` : ""} · {g.performedBy} · {new Date(g.performedAt).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={panel}>
        <h2 style={h2}>Lifecycle timeline</h2>
        {detail.workflow.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>No workflow events yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {detail.workflow.map((w, i) => (
              <li key={i}>
                {w.fromState ?? "∅"} → {w.toState} · {w.performedBy} · {new Date(w.performedAt).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function PlanField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <strong style={{ color: "var(--muted)", fontSize: 11 }}>{label}</strong>
      <div style={{ marginTop: 4 }}>{value}</div>
    </div>
  );
}

function PlanList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <strong style={{ color: "var(--muted)", fontSize: 11 }}>{label}</strong>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

const panel: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 16,
};

const h2: React.CSSProperties = { margin: "0 0 10px", fontSize: 16 };

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  boxSizing: "border-box",
};
