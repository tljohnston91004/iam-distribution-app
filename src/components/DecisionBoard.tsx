"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { RecommendationCard } from "@/components/RecommendationCard";
import { KeystrokeUploadPanel } from "@/components/KeystrokeUploadPanel";
import type { RunBanner } from "@/lib/iam/banners";
import {
  LANE_LABELS,
  LANE_ORDER,
  type BoardPersona,
  type BoardRecommendation,
} from "@/lib/iam/board/types";
import {
  buildBusinessMomentum,
  buildWeeklyBusinessSummary,
} from "@/lib/iam/presentation/summary";
import { isActivePriorityCategory, isWaitingCategory } from "@/lib/iam/presentation/rules";

type Health = {
  readinessStatus: string;
  runStatus: string;
  cycleStatus: string;
  recommendationCount: number;
  dataGapCount: number;
  inventoryCount: number;
  demandCount: number;
  laneCounts: Record<string, number>;
  scoringProfileNote: string;
  oec?: number;
  agingDays?: number;
  companyId?: string;
  companyName?: string;
};

const btn: React.CSSProperties = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 14px",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 13,
};

const primaryBtn: React.CSSProperties = {
  ...btn,
  background: "var(--accent)",
  color: "#04122a",
  fontWeight: 600,
  border: "none",
};

const ONBOARD_KEY = "iam-eep-onboarding-dismissed";

export function DecisionBoard({
  runId,
  recommendations,
  health,
  banners,
  nextAction,
  initialPersona = "executive",
  evidenceCounts,
  oecConsumed = 0,
}: {
  runId: string;
  recommendations: BoardRecommendation[];
  health: Health;
  banners: RunBanner[];
  nextAction: string;
  initialPersona?: BoardPersona;
  evidenceCounts: { inventorySnapshots: number; demandHistory: number; incomingSupply: number };
  oecConsumed?: number;
}) {
  const router = useRouter();
  const [persona, setPersona] = useState<BoardPersona>(initialPersona);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgIsError, setMsgIsError] = useState(false);
  const [showOps, setShowOps] = useState(persona === "operations");
  const [showOnboard, setShowOnboard] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    waiting_activation: true,
    deferred: true,
    completed: true,
  });
  const [oecDraft, setOecDraft] = useState(String(health.oec ?? 2));
  /** Local board rows — updated optimistically so Present/Approve don't depend on a heavy refresh. */
  const [recs, setRecs] = useState(recommendations);

  useEffect(() => {
    setRecs(recommendations);
  }, [recommendations]);

  useEffect(() => {
    try {
      if (typeof window !== "undefined" && !localStorage.getItem(ONBOARD_KEY)) {
        setShowOnboard(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const byLane = useMemo(() => {
    const map: Record<string, BoardRecommendation[]> = {};
    for (const lane of LANE_ORDER) map[lane] = [];
    map.completed = [];
    for (const r of recs) {
      if (r.presentationCategory === "completed_presentation" || r.lifecycleState === "Archived") {
        map.completed.push(r);
        continue;
      }
      if (r.presentationCategory === "archived_history") continue;
      let key = r.presentationCategory;
      if (isActivePriorityCategory(key)) key = "active_priority";
      else if (isWaitingCategory(key)) key = "waiting_activation";
      if (!LANE_ORDER.includes(key as (typeof LANE_ORDER)[number])) {
        key = "waiting_activation";
      }
      if (!map[key]) map[key] = [];
      map[key].push(r);
    }
    return map;
  }, [recs]);

  const oec = health.oec ?? 2;
  const summary = useMemo(
    () =>
      buildWeeklyBusinessSummary({
        recommendationCount: health.recommendationCount,
        dataGapCount: health.dataGapCount,
        readinessStatus: health.readinessStatus,
        recommendations: recs,
        oec,
        oecConsumed,
      }),
    [health, recs, oec, oecConsumed]
  );
  const momentum = useMemo(
    () =>
      buildBusinessMomentum({
        recommendations: recs,
        completedCount: byLane.completed?.length ?? 0,
        deferredCount: byLane.deferred?.length ?? 0,
        dataGapCount: health.dataGapCount,
      }),
    [recs, byLane, health.dataGapCount]
  );

  const decisionsNeeded = recs.filter(
    (r) =>
      r.lifecycleState === "Management Review" &&
      (isActivePriorityCategory(r.presentationCategory) || isWaitingCategory(r.presentationCategory))
  );

  function applyOptimisticLifecycle(id: string, action: string) {
    const nextState =
      action === "present_for_review"
        ? "Management Review"
        : action === "approve"
          ? "Approved"
          : action === "start_assignment"
            ? "Assignment Pending"
            : action === "assign"
              ? "Awaiting Acceptance"
              : action === "accept"
                ? "Active"
                : action === "pause"
                  ? "Paused"
                  : action === "resume"
                    ? "Active"
                    : action === "escalate"
                      ? "Escalated"
                      : action === "complete"
                        ? "Completed"
                        : action === "start_outcome_validation"
                          ? "Outcome Validation"
                          : action === "pass_outcome_validation"
                            ? "Archived"
                            : null;
    if (!nextState) return;
    setRecs((prev) =>
      prev.map((r) => (r.id === id ? { ...r, lifecycleState: nextState } : r))
    );
  }

  async function runAction(id: string, action: string, body: Record<string, unknown> = {}) {
    if (action === "__refresh__") {
      void Promise.resolve(router.refresh()).catch(() => undefined);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/recommendations/${id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, performedBy: personaLabel(persona), ...body }),
      });
      const text = await res.text();
      let data: { error?: string; code?: string; status?: string; action?: string } = {};
      try {
        data = text ? (JSON.parse(text) as typeof data) : {};
      } catch {
        throw new Error(
          res.ok
            ? "Server returned a non-JSON response"
            : `Action failed (HTTP ${res.status}). Is Start IAM.bat running? Try restarting it.`
        );
      }
      if (!res.ok) {
        throw new Error(data.error ?? `Action failed (${data.code ?? `HTTP ${res.status}`})`);
      }
      applyOptimisticLifecycle(id, action);
      setMsgIsError(false);
      setMsg(
        action === "present_for_review"
          ? "Presented for management review — primary action is now Approve"
          : `OK: ${action}`
      );
      // Refresh in background; do not treat refresh/render failures as action failures.
      void Promise.resolve(router.refresh()).catch(() => undefined);
    } catch (e) {
      setMsgIsError(true);
      setMsg(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function recalculate() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/runs/${runId}/calculate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Calculate failed");
      setMsgIsError(false);
      const active =
        data.presentationLanes?.active_priority?.length ??
        data.featuredCount ??
        data.presentationLanes?.top_2?.length ??
        "?";
      setMsg(`Scored ${data.scoredCount ?? "?"} · Active Priorities: ${active}`);
      router.refresh();
    } catch (e) {
      setMsgIsError(true);
      setMsg(e instanceof Error ? e.message : "Calculate failed");
    } finally {
      setBusy(false);
    }
  }

  async function approveEvidence() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/runs/${runId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", performedBy: personaLabel(persona) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Approve evidence failed");
      setMsgIsError(false);
      setMsg("Evidence approved — Calculate is unlocked");
      router.refresh();
    } catch (e) {
      setMsgIsError(true);
      setMsg(e instanceof Error ? e.message : "Approve evidence failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveOec() {
    if (!health.companyId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/companies/${health.companyId}/oec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationalExecutionCapability: Number(oecDraft),
          iamRunId: runId,
          performedBy: personaLabel(persona),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "OEC update failed");
      setMsgIsError(false);
      setMsg(`OEC updated to ${data.organizationalExecutionCapability}`);
      await recalculate();
    } catch (e) {
      setMsgIsError(true);
      setMsg(e instanceof Error ? e.message : "OEC update failed");
      setBusy(false);
    }
  }

  const visibleLanes =
    persona === "owner"
      ? (["holdover", "active_priority", "waiting_activation", "deferred"] as const)
      : LANE_ORDER;

  function toggle(key: string) {
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 20 }}>
      {showOnboard && (
        <section
          role="region"
          aria-label="First five minutes"
          style={{
            background: "var(--panel)",
            border: "1px solid var(--accent)",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Your first five minutes</h2>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
            <li>Read the Weekly Business Summary — what needs attention this week.</li>
            <li>Check Business Momentum — direction and why.</li>
            <li>Decide on Active Priorities (within OEC capacity) — one primary action each.</li>
            <li>Scan Decisions Requiring Management, then WIP progress.</li>
            <li>Waiting and Deferred stay collapsed until you need them.</li>
          </ol>
          <button
            type="button"
            style={{ ...btn, marginTop: 12 }}
            onClick={() => {
              try {
                localStorage.setItem(ONBOARD_KEY, "1");
              } catch {
                /* ignore */
              }
              setShowOnboard(false);
            }}
          >
            Got it — dismiss
          </button>
        </section>
      )}

      <section
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="tablist" aria-label="Role view">
          {(["executive", "operations", "owner"] as BoardPersona[]).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={persona === p}
              style={{
                ...btn,
                background: persona === p ? "var(--accent)" : "var(--panel-2)",
                color: persona === p ? "#04122a" : "var(--text)",
                fontWeight: persona === p ? 600 : 400,
                border: persona === p ? "none" : btn.border,
              }}
              onClick={() => {
                setPersona(p);
                setShowOps(p === "operations");
              }}
            >
              View as {p === "executive" ? "Executive" : p === "operations" ? "Operations" : "Owner"}
            </button>
          ))}
        </div>
        {persona !== "executive" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
            Soft viewAs — UX convenience only (not security; Phase 6 RBAC)
          </p>
        )}
      </section>

      {/* Stage 1 — Weekly Business Summary */}
      <section
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
          Weekly Business Summary · Attention: {summary.attentionZone}
        </p>
        <h2 style={{ margin: "6px 0", fontSize: 20 }}>{summary.headline}</h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--muted)" }}>
          {summary.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </section>

      {/* Stage 2 — Momentum + OEC */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
          <p style={{ margin: 0, fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>Business Momentum</p>
          <h3 style={{ margin: "6px 0", fontSize: 18, textTransform: "capitalize" }}>{momentum.direction}</h3>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{momentum.reason}</p>
        </div>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
          <p style={{ margin: 0, fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>
            Organizational Execution Capability
          </p>
          <h3 style={{ margin: "6px 0", fontSize: 18 }}>
            {oecConsumed} / {oec} slots used
          </h3>
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>
            Active Priorities + Holdover consume capacity. Paused, Deferred, and Waiting do not.
          </p>
          {(persona === "executive" || persona === "operations") && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ fontSize: 12 }}>
                OEC
                <input
                  type="number"
                  min={1}
                  value={oecDraft}
                  onChange={(e) => setOecDraft(e.target.value)}
                  style={{
                    marginLeft: 8,
                    width: 64,
                    padding: 6,
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                  }}
                  aria-label="Organizational Execution Capability"
                />
              </label>
              <button type="button" style={btn} disabled={busy} onClick={saveOec}>
                Save OEC
              </button>
            </div>
          )}
        </div>
      </section>

      {banners.length > 0 && persona !== "executive" && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 14, textTransform: "uppercase", letterSpacing: 1, color: "var(--muted)" }}>
            Alerts
          </h2>
          {banners.map((b, i) => (
            <div
              key={i}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: `1px solid ${b.level === "warn" ? "var(--warn)" : "var(--border)"}`,
                background: "var(--panel)",
                fontSize: 13,
              }}
            >
              {b.message}
            </div>
          ))}
        </section>
      )}

      {persona === "executive" && banners.some((b) => b.level === "warn") && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--warn)" }}>
          {banners.filter((b) => b.level === "warn").map((b) => b.message).join(" · ")}
        </p>
      )}

      <p style={{ margin: 0, fontSize: 14 }}>
        <strong>Next best action:</strong> {nextAction}
      </p>

      {msg && (
        <p style={{ margin: 0, color: msgIsError ? "var(--bad)" : "var(--good)", fontSize: 13 }} role="status">
          {msg}
        </p>
      )}

      {/* Stage 4 — Decisions requiring management */}
      {decisionsNeeded.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Decisions Requiring Management</h2>
          {decisionsNeeded.map((rec) => (
            <RecommendationCard
              key={`dec-${rec.id}`}
              runId={runId}
              rec={rec}
              persona={persona}
              onAction={runAction}
              busy={busy}
            />
          ))}
        </section>
      )}

      {(persona === "operations" || showOps) && (
        <section
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Operations intake</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={btn} disabled={busy} onClick={approveEvidence}>
                Approve evidence
              </button>
              <button type="button" style={primaryBtn} disabled={busy} onClick={recalculate}>
                Calculate · Score · Present
              </button>
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
            Evidence: inv {evidenceCounts.inventorySnapshots} · demand {evidenceCounts.demandHistory} · supply{" "}
            {evidenceCounts.incomingSupply}
          </p>
          <p style={{ fontSize: 11, color: "var(--muted)" }}>
            Upload → Merge → Approve evidence → Calculate. Profile: {health.scoringProfileNote}
          </p>
          <KeystrokeUploadPanel runId={runId} />
        </section>
      )}

      {persona === "owner" && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
          Owner view emphasizes assigned / open work. Accept items awaiting acceptance. Update progress on Active work.
        </p>
      )}

      {visibleLanes.map((lane) => {
        let items = byLane[lane] ?? [];
        if (persona === "owner") {
          items = items.filter(
            (r) =>
              r.ownerUserId ||
              r.lifecycleState === "Awaiting Acceptance" ||
              r.lifecycleState === "Active" ||
              r.lifecycleState === "Paused" ||
              r.lifecycleState === "Escalated"
          );
        }
        // Avoid duplicating cards already shown in Decisions strip for Active Priorities
        if (lane === "active_priority") {
          items = items.filter((r) => r.lifecycleState !== "Management Review");
        }

        const fullCount = items.length;
        // Waiting can be huge after a wide Calculate — render a window so Present/Approve stays responsive.
        if (lane === "waiting_activation" && items.length > 30) {
          items = items.slice(0, 30);
        }

        const defaultCollapse =
          persona === "executive" && (lane === "waiting_activation" || lane === "deferred");
        const isCollapsed = collapsed[lane] ?? defaultCollapse;

        return (
          <section key={lane} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>
                <button
                  type="button"
                  onClick={() => toggle(lane)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    padding: 0,
                    font: "inherit",
                    textAlign: "left",
                  }}
                  aria-expanded={!isCollapsed}
                >
                  {LANE_LABELS[lane]} {isCollapsed ? "▸" : "▾"}
                </button>
              </h2>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{fullCount} item(s)</span>
            </div>
            {!isCollapsed && lane === "emergency" && items.length === 0 && (
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
                No emergency elevation this cycle. (Auto-assignment waits on SD-2.)
              </p>
            )}
            {!isCollapsed && items.length === 0 && lane !== "emergency" && (
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>No recommendations in this lane.</p>
            )}
            {!isCollapsed && lane === "waiting_activation" && fullCount > items.length && (
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                Showing top {items.length} of {fullCount}. Re-run Calculate after restart to keep the Board
                capped (~80 priorities).
              </p>
            )}
            {!isCollapsed &&
              items.map((rec) => (
                <RecommendationCard
                  key={rec.id}
                  runId={runId}
                  rec={rec}
                  persona={persona}
                  onAction={runAction}
                  busy={busy}
                />
              ))}
          </section>
        );
      })}

      {/* Recently Completed */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>
          <button
            type="button"
            onClick={() => toggle("completed")}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: 0,
              font: "inherit",
            }}
            aria-expanded={!collapsed.completed}
          >
            Recently Completed {collapsed.completed ? "▸" : "▾"}
          </button>
        </h2>
        {!collapsed.completed && (byLane.completed?.length ?? 0) === 0 && (
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>No completed items in this cycle yet.</p>
        )}
        {!collapsed.completed &&
          (byLane.completed ?? []).map((rec) => (
            <RecommendationCard
              key={rec.id}
              runId={runId}
              rec={rec}
              persona={persona}
              onAction={runAction}
              busy={busy}
              compact
            />
          ))}
      </section>
    </div>
  );
}

function personaLabel(p: BoardPersona) {
  if (p === "executive") return "executive-user";
  if (p === "operations") return "operations-user";
  return "owner-user";
}
