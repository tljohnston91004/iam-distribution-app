"use client";

import Link from "next/link";
import { useState } from "react";
import { usd } from "@/lib/format";
import {
  primaryCtaLabel,
  requiredActionHint,
  type BoardPersona,
  type BoardRecommendation,
} from "@/lib/iam/board/types";
import { isActivePriorityCategory } from "@/lib/iam/presentation/rules";

const btn: React.CSSProperties = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 10px",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 12,
};

const primaryBtn: React.CSSProperties = {
  ...btn,
  background: "var(--accent)",
  color: "#04122a",
  fontWeight: 600,
  border: "none",
};

type FormKind = "defer" | "reject" | "assign" | "pause" | "escalate" | "progress" | null;

export function RecommendationCard({
  runId,
  rec,
  persona,
  onAction,
  busy,
  compact = false,
}: {
  runId: string;
  rec: BoardRecommendation;
  persona: BoardPersona;
  onAction: (id: string, action: string, body?: Record<string, unknown>) => void;
  busy: boolean;
  compact?: boolean;
}) {
  const cash = rec.estimatedCashImpact ?? rec.estimatedFinancialImpact;
  const isOwner = persona === "owner";
  const isExecOrOps = persona === "executive" || persona === "operations";
  const primary = primaryCtaLabel(rec.lifecycleState, rec.presentationCategory);
  const [form, setForm] = useState<FormKind>(null);
  const [reason, setReason] = useState("");
  const [ownerId, setOwnerId] = useState("owner-1");
  const [ownerName, setOwnerName] = useState("Pilot Manager");
  const [approvedBy, setApprovedBy] = useState("executive");
  const [progress, setProgress] = useState(rec.progressNarrative ?? "");
  const [blocker, setBlocker] = useState(rec.blockerNote ?? "");
  const [expected, setExpected] = useState(
    rec.expectedCompletionAt ? rec.expectedCompletionAt.slice(0, 10) : ""
  );
  const [showMembers, setShowMembers] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const showTrust = isActivePriorityCategory(rec.presentationCategory) || rec.presentationCategory === "holdover";

  let memberSkus: {
    skuOrItemId: string;
    inventoryValue?: number | null;
    recommendedAction?: string;
  }[] = [];
  let planSummary: string | null = null;
  let planGroups: { actionLabel: string; skuCount: number; excessValue: number }[] = [];
  let dataQualityWarning: string | null = null;
  let recommendedManagementAction: string | null = null;
  if (rec.explainabilityJson) {
    try {
      const ex = JSON.parse(rec.explainabilityJson) as {
        memberSkus?: { skuOrItemId: string; inventoryValue?: number | null; recommendedAction?: string }[];
        detail?: {
          memberSkus?: { skuOrItemId: string; inventoryValue?: number | null; recommendedAction?: string }[];
          prescribedActionPlan?: {
            summaryLine?: string;
            recommendedManagementAction?: string;
            actionGroups?: { actionLabel: string; skuCount: number; excessValue: number }[];
          };
          dataQualityWarning?: string | null;
        };
        prescribedActionPlan?: {
          summaryLine?: string;
          recommendedManagementAction?: string;
          actionGroups?: { actionLabel: string; skuCount: number; excessValue: number }[];
        };
        recommendedManagementAction?: string | null;
        dataQualityWarning?: string | null;
      };
      memberSkus = ex.memberSkus ?? ex.detail?.memberSkus ?? [];
      const plan = ex.prescribedActionPlan ?? ex.detail?.prescribedActionPlan;
      planSummary = plan?.summaryLine ?? plan?.recommendedManagementAction ?? null;
      recommendedManagementAction =
        ex.recommendedManagementAction ?? plan?.recommendedManagementAction ?? null;
      planGroups = plan?.actionGroups ?? [];
      dataQualityWarning = ex.dataQualityWarning ?? ex.detail?.dataQualityWarning ?? null;
    } catch {
      memberSkus = [];
    }
  }

  function runPrimary() {
    if (!primary) return;
    if (primary === "Present for review") onAction(rec.id, "present_for_review");
    else if (primary === "Approve") onAction(rec.id, "approve");
    else if (primary === "Reactivate") onAction(rec.id, "reactivate_defer");
    else if (primary === "Assign owner") setForm("assign");
    else if (primary === "Accept assignment")
      onAction(rec.id, "accept", { ownerUserId: rec.ownerUserId ?? undefined });
    else if (primary === "Resume") onAction(rec.id, "resume");
    else if (primary === "Update progress") setForm("progress");
    else if (primary === "Validate outcome") onAction(rec.id, "start_outcome_validation");
  }

  async function saveProgress() {
    const res = await fetch(`/api/recommendations/${rec.id}/progress`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        progressNarrative: progress,
        blockerNote: blocker || null,
        expectedCompletionAt: expected || null,
        performedBy: persona === "owner" ? "owner-user" : "executive-user",
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Progress update failed");
    }
    setForm(null);
    onAction(rec.id, "__refresh__");
  }

  return (
    <article
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
            <span style={chip(rec.presentationCategory)}>{labelCat(rec.presentationCategory)}</span>
            <span style={chip("ls")}>{rec.lifecycleState}</span>
            {rec.lifecycleState === "Awaiting Acceptance" && !rec.ownerAccepted && (
              <span style={chip("warn")}>Waiting owner acceptance</span>
            )}
            {rec.generationPath === "interim_evidence" && (
              <span style={chip("interim")}>Interim evidence</span>
            )}
            {rec.presentationRank != null && isActivePriorityCategory(rec.presentationCategory) && (
              <span style={chip("rank")}>#{rec.presentationRank}</span>
            )}
            {rec.agingAdvisory && <span style={chip("warn")}>Aging advisory</span>}
          </div>
          <h3 style={{ margin: 0, fontSize: 16 }}>{rec.title}</h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
            {rec.recommendationType}
            {rec.analysisGrain === "segment"
              ? ` · Segment (${rec.segmentType ?? "group"}: ${rec.segmentKey ?? "—"}) · ${rec.affectedSkuCount ?? "?"} SKUs`
              : rec.skuOrItemId
                ? ` · ${rec.skuOrItemId}`
                : ""}{" "}
            · Source: {rec.sourceModule}
          </p>
        </div>
        <div style={{ textAlign: "right", fontSize: 12, color: "var(--muted)", minWidth: 100 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
            {rec.priorityScore != null ? rec.priorityScore.toFixed(1) : "—"}
          </div>
          <div>Priority</div>
        </div>
      </div>

      {showTrust && !compact && (
        <div
          style={{
            display: "grid",
            gap: 6,
            fontSize: 13,
            background: "var(--panel-2)",
            borderRadius: 8,
            padding: 12,
          }}
        >
          <TrustLine label="What" text={rec.storyWhat} />
          <TrustLine label="Why" text={rec.storyWhy} />
          <TrustLine label="Why now" text={rec.storyWhyNow} />
          <TrustLine label="Expected result" text={rec.storyExpectedResult} />
          <TrustLine label="Confidence" text={rec.confidenceNarrative ?? rec.confidence} />
        </div>
      )}

      {dataQualityWarning && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--warn)" }}>
          Data quality: {dataQualityWarning}
        </p>
      )}

      {!compact && (recommendedManagementAction || planSummary) && (
        <div
          style={{
            fontSize: 13,
            background: "var(--panel-2)",
            borderRadius: 8,
            padding: 12,
            borderLeft: "3px solid var(--accent)",
          }}
        >
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
            Prescribed Action Plan
          </div>
          <div style={{ fontWeight: 600 }}>{recommendedManagementAction ?? planSummary}</div>
          {planGroups.length > 0 && (
            <button
              type="button"
              style={{ ...btn, marginTop: 8 }}
              onClick={() => setShowPlan((v) => !v)}
              aria-expanded={showPlan}
            >
              {showPlan ? "Hide" : "Show"} action groups ({planGroups.length})
            </button>
          )}
          {showPlan && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--muted)", fontSize: 12 }}>
              {planGroups.map((g) => (
                <li key={g.actionLabel}>
                  {g.actionLabel}: {g.skuCount} SKUs · {usd(g.excessValue)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!compact && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 8,
            fontSize: 12,
          }}
        >
          <Metric label="Cash impact" value={cash != null ? usd(cash) : "—"} />
          <Metric label="COI" value={rec.costOfInaction != null ? usd(rec.costOfInaction) : "Not available"} />
          {rec.analysisGrain === "segment" && (
            <Metric
              label="Affected SKUs"
              value={String(rec.affectedSkuCount ?? memberSkus.length)}
            />
          )}
          <Metric
            label="Owner"
            value={
              rec.ownerName || rec.ownerUserId
                ? `${rec.ownerName ?? rec.ownerUserId}${rec.ownerAccepted ? " ✓" : " (pending)"}`
                : "Unassigned"
            }
          />
        </div>
      )}

      {!compact && rec.analysisGrain === "segment" && memberSkus.length > 0 && (
        <div style={{ fontSize: 12 }}>
          <button
            type="button"
            style={{ ...btn, marginBottom: 6 }}
            onClick={() => setShowMembers((v) => !v)}
            aria-expanded={showMembers}
          >
            {showMembers ? "Hide" : "Show"} supporting SKUs ({memberSkus.length})
          </button>
          {showMembers && (
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--muted)", maxHeight: 160, overflow: "auto" }}>
              {memberSkus.slice(0, 50).map((m) => (
                <li key={m.skuOrItemId}>
                  {m.skuOrItemId}
                  {m.inventoryValue != null ? ` · ${usd(m.inventoryValue)}` : ""}
                  {m.recommendedAction ? ` · ${m.recommendedAction}` : ""}
                </li>
              ))}
              {memberSkus.length > 50 && <li>…and {memberSkus.length - 50} more</li>}
            </ul>
          )}
        </div>
      )}

      {(rec.progressNarrative || rec.blockerNote || rec.presentationCategory === "holdover") && (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {rec.progressNarrative && <div>Progress: {rec.progressNarrative}</div>}
          {rec.blockerNote && <div style={{ color: "var(--warn)" }}>Blocker: {rec.blockerNote}</div>}
          {rec.lastProgressAt && <div>Last update: {new Date(rec.lastProgressAt).toLocaleString()}</div>}
          {rec.expectedCompletionAt && (
            <div>Expected completion: {new Date(rec.expectedCompletionAt).toLocaleDateString()}</div>
          )}
        </div>
      )}

      {rec.agingAdvisory && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--warn)" }}>{rec.agingAdvisory}</p>
      )}

      <p style={{ margin: 0, fontSize: 13, color: "var(--accent)" }}>
        Required: {requiredActionHint(rec.lifecycleState, rec.presentationCategory)}
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {primary && (
          <button type="button" style={primaryBtn} disabled={busy} onClick={runPrimary}>
            {primary}
          </button>
        )}
        <Link
          href={`/runs/${runId}/recommendations/${rec.id}?viewAs=${persona}`}
          style={{ ...btn, textDecoration: "none" }}
        >
          Details
        </Link>

        {isExecOrOps && rec.lifecycleState === "Management Review" && rec.presentationCategory !== "deferred" && (
          <>
            <button type="button" style={btn} disabled={busy} onClick={() => setForm("defer")}>
              Defer…
            </button>
            <button type="button" style={btn} disabled={busy} onClick={() => setForm("reject")}>
              Reject…
            </button>
          </>
        )}
        {isExecOrOps && rec.lifecycleState === "Active" && (
          <>
            <button type="button" style={btn} disabled={busy} onClick={() => setForm("pause")}>
              Pause…
            </button>
            <button type="button" style={btn} disabled={busy} onClick={() => setForm("escalate")}>
              Escalate…
            </button>
          </>
        )}
        {(isOwner || isExecOrOps) &&
          (rec.lifecycleState === "Paused" || rec.lifecycleState === "Escalated") &&
          primary !== "Resume" && (
            <button type="button" style={btn} disabled={busy} onClick={() => onAction(rec.id, "resume")}>
              Resume
            </button>
          )}
      </div>

      {form && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {(form === "defer" || form === "reject" || form === "pause" || form === "escalate") && (
            <label style={{ fontSize: 12 }}>
              Reason
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={inputStyle}
                aria-label="Reason"
              />
            </label>
          )}
          {form === "pause" && (
            <label style={{ fontSize: 12 }}>
              Approved by
              <input
                value={approvedBy}
                onChange={(e) => setApprovedBy(e.target.value)}
                style={inputStyle}
                aria-label="Approved by"
              />
            </label>
          )}
          {form === "assign" && (
            <>
              <label style={{ fontSize: 12 }}>
                Owner user id
                <input value={ownerId} onChange={(e) => setOwnerId(e.target.value)} style={inputStyle} />
              </label>
              <label style={{ fontSize: 12 }}>
                Owner name
                <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} style={inputStyle} />
              </label>
            </>
          )}
          {form === "progress" && (
            <>
              <label style={{ fontSize: 12 }}>
                Progress
                <textarea value={progress} onChange={(e) => setProgress(e.target.value)} style={{ ...inputStyle, minHeight: 60 }} />
              </label>
              <label style={{ fontSize: 12 }}>
                Blocker (optional)
                <input value={blocker} onChange={(e) => setBlocker(e.target.value)} style={inputStyle} />
              </label>
              <label style={{ fontSize: 12 }}>
                Expected completion
                <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} style={inputStyle} />
              </label>
            </>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              style={primaryBtn}
              disabled={busy}
              onClick={async () => {
                if (form === "defer" && reason) onAction(rec.id, "defer", { reason });
                if (form === "reject" && reason) onAction(rec.id, "reject", { reason });
                if (form === "pause" && reason && approvedBy)
                  onAction(rec.id, "pause", { reason, approvedBy });
                if (form === "escalate" && reason) onAction(rec.id, "escalate", { reason });
                if (form === "assign" && ownerId)
                  onAction(rec.id, "assign", {
                    primaryOwnerUserId: ownerId,
                    primaryOwnerName: ownerName || undefined,
                  });
                if (form === "progress") {
                  try {
                    await saveProgress();
                  } catch (e) {
                    alert(e instanceof Error ? e.message : "Failed");
                  }
                }
                if (form !== "progress") setForm(null);
              }}
            >
              Confirm
            </button>
            <button type="button" style={btn} onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function TrustLine({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div>
      <strong style={{ color: "var(--muted)", fontSize: 11 }}>{label}: </strong>
      {text}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--panel-2)", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ color: "var(--muted)", fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function labelCat(cat: string) {
  if (cat === "active_priority" || cat === "top_2") return "Active Priority";
  if (cat === "waiting_activation" || cat === "managed_backlog") return "Waiting";
  return cat;
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  boxSizing: "border-box",
};

function chip(kind: string): React.CSSProperties {
  const colors: Record<string, string> = {
    active_priority: "var(--accent)",
    top_2: "var(--accent)",
    waiting_activation: "var(--muted)",
    managed_backlog: "var(--muted)",
    deferred: "var(--warn)",
    holdover: "#7ab0ff",
    emergency: "var(--bad)",
    interim: "var(--warn)",
    warn: "var(--warn)",
    ls: "var(--muted)",
    rank: "var(--accent)",
  };
  return {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    padding: "2px 6px",
    borderRadius: 4,
    border: `1px solid ${colors[kind] ?? "var(--border)"}`,
    color: colors[kind] ?? "var(--muted)",
  };
}
