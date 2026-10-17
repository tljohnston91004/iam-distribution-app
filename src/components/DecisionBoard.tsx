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
  boardRyg,
  guidingQuestion,
  moneyTiles,
} from "@/lib/iam/board/dpos-copy";
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
  annualCarryingCostRate?: number | null;
  carryingCostRateConfigured?: boolean;
  carryingCostRateDisplayPercent?: number | null;
  companyConfigHref?: string;
};

const outlineBtn: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--accent)",
  borderRadius: 8,
  padding: "8px 14px",
  color: "var(--accent)",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const ghostBtn: React.CSSProperties = {
  ...outlineBtn,
  border: "1px solid var(--border)",
  color: "var(--text)",
  fontWeight: 500,
};

const primaryBtn: React.CSSProperties = {
  ...outlineBtn,
  background: "var(--accent)",
  color: "#fff",
};

const ONBOARD_KEY = "iam-eep-onboarding-dismissed";

function rygStyle(label: "Gray" | "Yellow" | "Green" | "Red"): React.CSSProperties {
  const map = {
    Gray: { background: "var(--ryg-gray-bg)", color: "var(--muted)" },
    Yellow: { background: "var(--ryg-yellow-bg)", color: "var(--warn)" },
    Green: { background: "var(--ryg-green-bg)", color: "var(--good)" },
    Red: { background: "var(--ryg-red-bg)", color: "var(--bad)" },
  };
  return {
    display: "inline-block",
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: 13,
    fontWeight: 700,
    ...map[label],
  };
}

export function DecisionBoard({
  runId,
  recommendations,
  health,
  banners,
  nextAction,
  initialPersona = "executive",
  evidenceCounts,
  oecConsumed = 0,
  reviewWeekLabel,
}: {
  runId: string;
  recommendations: BoardRecommendation[];
  health: Health;
  banners: RunBanner[];
  nextAction: string;
  initialPersona?: BoardPersona;
  evidenceCounts: { inventorySnapshots: number; demandHistory: number; incomingSupply: number };
  oecConsumed?: number;
  reviewWeekLabel?: string;
}) {
  const router = useRouter();
  const [persona, setPersona] = useState<BoardPersona>(initialPersona);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgIsError, setMsgIsError] = useState(false);
  const [showOps, setShowOps] = useState(persona === "operations");
  const [showOnboard, setShowOnboard] = useState(false);
  const [showContext, setShowContext] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    waiting_activation: true,
    deferred: true,
    completed: true,
  });
  const [oecDraft, setOecDraft] = useState(String(health.oec ?? 2));
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

  const ryg = useMemo(
    () =>
      boardRyg({
        readinessStatus: health.readinessStatus,
        recommendationCount: health.recommendationCount,
        dataGapCount: health.dataGapCount,
        decisionsNeeded: decisionsNeeded.length,
      }),
    [health, decisionsNeeded.length]
  );

  const question = useMemo(() => guidingQuestion(recs), [recs]);
  const tiles = useMemo(() => moneyTiles(recs, health.dataGapCount), [recs, health.dataGapCount]);

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
                            : action === "defer"
                              ? "Identified"
                              : null;
    if (!nextState && action !== "defer") return;
    setRecs((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        if (action === "defer") {
          return { ...r, presentationCategory: "deferred", lifecycleState: r.lifecycleState };
        }
        return { ...r, lifecycleState: nextState! };
      })
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
            : `Action failed (HTTP ${res.status}). Is the IAM app running?`
        );
      }
      if (!res.ok) {
        throw new Error(data.error ?? `Action failed (${data.code ?? `HTTP ${res.status}`})`);
      }
      applyOptimisticLifecycle(id, action);
      setMsgIsError(false);
      setMsg(
        action === "present_for_review"
          ? "Taken on — presented for management review. Primary action is now Approve."
          : action === "approve"
            ? "Taken on — approved for assignment."
            : action === "defer"
              ? "Not this week — deferred. It will return as holdover context next cycle."
              : `OK: ${action}`
      );
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
      setMsg(`Capacity (OEC) updated to ${data.organizationalExecutionCapability}`);
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
    <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 8 }}>
      {/* Company-home Decision Board chrome */}
      <section
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: "22px 24px",
        }}
      >
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
          {reviewWeekLabel ? `Last completed board: ${reviewWeekLabel}` : "Current review cycle board"}
        </p>
        <h2 style={{ margin: "8px 0 6px", fontSize: 26, fontWeight: 700, lineHeight: 1.25 }}>
          {question}
        </h2>
        <p style={{ margin: 0, fontSize: 15, color: "var(--muted)", maxWidth: 720 }}>
          What to take on, why it matters, and whether last week’s work is still unfinished.
        </p>
        <p style={{ margin: "14px 0 0", fontSize: 14 }}>
          <span style={rygStyle(ryg.label)}>Board RYG: {ryg.label}</span>
          <span style={{ marginLeft: 10, color: "var(--muted)" }}>— {ryg.note}</span>
        </p>
        <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--muted)" }}>
          Official priorities are current IAM inventory actions for this cycle. RSE / PRE signals are
          supporting context when present. Decision Board status is not a company-health score.
        </p>
      </section>

      {/* Company + money tiles */}
      <section
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: "20px 22px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 20 }}>{health.companyName ?? "Company"}</h3>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Evidence on this cycle: {evidenceCounts.inventorySnapshots} inventory ·{" "}
              {evidenceCounts.demandHistory} demand · {evidenceCounts.incomingSupply} supply
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 13, color: "var(--muted)" }}>
            <div>
              Capacity (OEC): <strong style={{ color: "var(--text)" }}>{oecConsumed} / {oec}</strong>
            </div>
            <div>
              Momentum: <strong style={{ color: "var(--text)", textTransform: "capitalize" }}>{momentum.direction}</strong>
            </div>
          </div>
        </div>

        <p style={{ margin: "14px 0 8px", fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
          Money on this board right now
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 12,
          }}
        >
          {tiles.map((t) => (
            <div
              key={t.label}
              style={{
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 700 }}>{t.amount}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{t.label}</div>
            </div>
          ))}
        </div>

        <p style={{ margin: "14px 0 0", fontSize: 13, color: "var(--muted)" }}>
          {summary.headline} Attention: {summary.attentionZone}. Next best action: {nextAction}
        </p>

        {(persona === "executive" || persona === "operations") && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>
              OEC capacity
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
                  background: "var(--panel)",
                  color: "var(--text)",
                }}
                aria-label="Organizational Execution Capability"
              />
            </label>
            <button type="button" style={ghostBtn} disabled={busy} onClick={saveOec}>
              Save OEC
            </button>
          </div>
        )}
      </section>

      {/* What this means context */}
      <section
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: "16px 20px",
        }}
      >
        <button
          type="button"
          onClick={() => setShowContext((v) => !v)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            font: "inherit",
            fontWeight: 700,
            fontSize: 16,
            color: "var(--accent)",
          }}
          aria-expanded={showContext}
        >
          What this means {showContext ? "▾" : "▸"}
        </button>
        {showContext && (
          <ul style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 14, color: "var(--text)" }}>
            {summary.bullets.map((b, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {b}
              </li>
            ))}
            <li style={{ marginBottom: 6 }}>{momentum.reason}</li>
            <li style={{ marginBottom: 6 }}>
              Active Priorities + Holdover consume OEC capacity. Paused, Deferred, and Waiting do not.
            </li>
            {health.dataGapCount > 0 && (
              <li style={{ marginBottom: 6, color: "var(--warn)" }}>
                Critical or warning data gaps may reduce confidence in current recommendations.{" "}
                {health.dataGapCount} governed data-gap record(s).
              </li>
            )}
            <li style={{ color: "var(--muted)" }}>
              These figures came from this cycle’s evidence and scoring. The board did not invent them.
              Profile: {health.scoringProfileNote}
            </li>
          </ul>
        )}
      </section>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="tablist" aria-label="Role view">
          {(["executive", "operations", "owner"] as BoardPersona[]).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={persona === p}
              style={{
                ...(persona === p ? primaryBtn : ghostBtn),
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
            Soft viewAs — UX convenience only (not security)
          </p>
        )}
      </div>

      {showOnboard && (
        <section
          style={{
            background: "var(--accent-soft)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Your first five minutes</h2>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
            <li>Read the guiding question and Board RYG.</li>
            <li>Scan money on this board — what is economically in play.</li>
            <li>Decide on Active Priorities — Take this on or Not this week.</li>
            <li>Open Why? only when you need the explanation.</li>
            <li>Waiting and Deferred stay collapsed until you need them.</li>
          </ol>
          <button
            type="button"
            style={{ ...ghostBtn, marginTop: 12 }}
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

      {banners.length > 0 && persona !== "executive" && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
          {banners
            .filter((b) => b.level === "warn")
            .map((b) => b.message)
            .join(" · ")}
        </p>
      )}

      {msg && (
        <div
          style={{
            margin: 0,
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${msgIsError ? "var(--bad)" : "var(--border)"}`,
            background: "var(--panel)",
            color: msgIsError ? "var(--bad)" : "var(--good)",
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
          }}
          role="status"
        >
          <span>{msg}</span>
          <button
            type="button"
            style={{ ...ghostBtn, padding: "2px 8px", flexShrink: 0 }}
            onClick={() => {
              setMsg(null);
              setMsgIsError(false);
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
        Official management order. Unlike economic families are not a cash leaderboard. Capacity is{" "}
        {oec}. Not padded. One card per board issue.
      </p>

      {decisionsNeeded.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Decisions requiring management</h2>
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
            borderRadius: 14,
            padding: 16,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Operations intake</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={ghostBtn} disabled={busy} onClick={approveEvidence}>
                Approve evidence
              </button>
              <button type="button" style={primaryBtn} disabled={busy} onClick={recalculate}>
                Calculate · Score · Present
              </button>
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
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
        if (lane === "active_priority") {
          items = items.filter((r) => r.lifecycleState !== "Management Review");
        }

        const fullCount = items.length;
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
                No emergency elevation this cycle.
              </p>
            )}
            {!isCollapsed && items.length === 0 && lane !== "emergency" && (
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>No recommendations in this lane.</p>
            )}
            {!isCollapsed && lane === "waiting_activation" && fullCount > items.length && (
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                Showing top {items.length} of {fullCount}.
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
