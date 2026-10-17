"use client";

import Link from "next/link";
import { useState } from "react";
import { usd } from "@/lib/format";
import {
  primaryCtaLabel,
  type BoardPersona,
  type BoardRecommendation,
} from "@/lib/iam/board/types";
import {
  actSkipCopy,
  lookThisWeekRole,
  priorityBand,
} from "@/lib/iam/board/dpos-copy";
import { isActivePriorityCategory } from "@/lib/iam/presentation/rules";

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
  const [showWhy, setShowWhy] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const copy = actSkipCopy(rec);
  const band = priorityBand(rec.priorityScore);
  const equalPriority =
    isActivePriorityCategory(rec.presentationCategory) ||
    rec.lifecycleState === "Management Review";

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

  function takeThisOn() {
    if (!primary) {
      setShowWhy(true);
      return;
    }
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

  function notThisWeek() {
    if (rec.presentationCategory === "deferred") return;
    if (isExecOrOps && (rec.lifecycleState === "Management Review" || rec.lifecycleState === "Identified")) {
      setForm("defer");
      setReason("Not this week — capacity / timing");
      return;
    }
    setForm("defer");
    setReason("Not this week — capacity / timing");
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

  if (compact) {
    return (
      <article
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "14px 16px",
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div>
          <strong style={{ fontSize: 14 }}>{rec.title}</strong>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {rec.lifecycleState}
            {cash != null ? ` · ${usd(cash)}` : ""}
          </div>
        </div>
        <Link href={`/runs/${runId}/recommendations/${rec.id}?viewAs=${persona}`} style={ghostBtn}>
          Details
        </Link>
      </article>
    );
  }

  return (
    <article
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {equalPriority && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Equal management priority</p>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)", lineHeight: 1.25 }}>
            {rec.title}
            {cash != null && !rec.title.includes(usd(cash).replace(/\u00a0/g, " ")) && !rec.title.includes(String(Math.round(cash)))
              ? ` — ${usd(cash)}`
              : ""}
          </h3>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Priority band: {band}
            {rec.priorityScore != null ? ` · score ${rec.priorityScore.toFixed(1)}` : ""}
            {rec.presentationRank != null && isActivePriorityCategory(rec.presentationCategory)
              ? ` · #${rec.presentationRank}`
              : ""}
          </p>
        </div>
        <span
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            padding: "4px 8px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            color: "var(--muted)",
            whiteSpace: "nowrap",
          }}
        >
          {rec.lifecycleState}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
          fontSize: 13,
        }}
      >
        <Metric
          label="Cash / financial impact"
          value={cash != null ? usd(cash) : "Not quantified"}
        />
        <Metric
          label="Cost of inaction"
          value={
            rec.costOfInaction != null
              ? usd(rec.costOfInaction)
              : rec.companyCarryingCostRateConfigured === false
                ? "Rate not configured"
                : "Not available"
          }
        />
        {rec.analysisGrain === "segment" && (
          <Metric
            label="Affected SKUs"
            value={String(rec.affectedSkuCount ?? (memberSkus.length > 0 ? memberSkus.length : "—"))}
          />
        )}
        <Metric
          label="Source"
          value={`${rec.sourceModule}${rec.generationPath === "interim_evidence" ? " · interim" : ""}`}
        />
      </div>

      {dataQualityWarning && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--warn)" }}>
          Critical or warning data gaps may reduce confidence. {dataQualityWarning}
        </p>
      )}

      <div style={{ fontSize: 14, color: "var(--text)", display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ margin: 0 }}>
          <strong>What this means:</strong> {copy.means}
        </p>
        <p style={{ margin: 0 }}>
          <strong>Act.</strong> {copy.act.replace(/^Act\.\s*/i, "")}
        </p>
        <p style={{ margin: 0 }}>
          <strong>Skip.</strong> {copy.skip.replace(/^Skip\.\s*/i, "")}
        </p>
      </div>

      {(recommendedManagementAction || planSummary) && (
        <div
          style={{
            fontSize: 13,
            background: "var(--panel-2)",
            borderRadius: 8,
            padding: 12,
            borderLeft: "3px solid var(--accent)",
          }}
        >
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Prescribed Action Plan</div>
          <div style={{ fontWeight: 600 }}>{recommendedManagementAction ?? planSummary}</div>
          {planGroups.length > 0 && (
            <button type="button" style={{ ...ghostBtn, marginTop: 8 }} onClick={() => setShowPlan((v) => !v)}>
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

      {rec.analysisGrain === "segment" && memberSkus.length > 0 && (
        <div style={{ fontSize: 12 }}>
          <button type="button" style={ghostBtn} onClick={() => setShowMembers((v) => !v)}>
            {showMembers ? "Hide" : "Show"} supporting SKUs ({memberSkus.length})
          </button>
          {showMembers && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--muted)", maxHeight: 160, overflow: "auto" }}>
              {memberSkus.slice(0, 50).map((m) => (
                <li key={m.skuOrItemId}>
                  {m.skuOrItemId}
                  {m.inventoryValue != null ? ` · ${usd(m.inventoryValue)}` : ""}
                  {m.recommendedAction ? ` · ${m.recommendedAction}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(rec.progressNarrative || rec.blockerNote) && (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {rec.progressNarrative && <div>Progress: {rec.progressNarrative}</div>}
          {rec.blockerNote && <div style={{ color: "var(--warn)" }}>Blocker: {rec.blockerNote}</div>}
        </div>
      )}

      {rec.agingAdvisory && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--warn)" }}>{rec.agingAdvisory}</p>
      )}

      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{lookThisWeekRole(rec)}</p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {isExecOrOps || isOwner ? (
          <button type="button" style={primaryBtn} disabled={busy} onClick={takeThisOn}>
            Take this on
          </button>
        ) : null}
        {isExecOrOps && rec.presentationCategory !== "deferred" && (
          <button type="button" style={outlineBtn} disabled={busy} onClick={notThisWeek}>
            Not this week
          </button>
        )}
        <button type="button" style={ghostBtn} onClick={() => setShowWhy((v) => !v)}>
          Why?
        </button>
        <Link
          href={`/runs/${runId}/recommendations/${rec.id}?viewAs=${persona}`}
          style={{ ...ghostBtn, textDecoration: "none" }}
        >
          More on this board
        </Link>
        {isExecOrOps && rec.lifecycleState === "Management Review" && (
          <button type="button" style={ghostBtn} disabled={busy} onClick={() => setForm("reject")}>
            Reject…
          </button>
        )}
        {isExecOrOps && rec.lifecycleState === "Active" && (
          <>
            <button type="button" style={ghostBtn} disabled={busy} onClick={() => setForm("pause")}>
              Pause…
            </button>
            <button type="button" style={ghostBtn} disabled={busy} onClick={() => setForm("escalate")}>
              Escalate…
            </button>
          </>
        )}
      </div>

      {showWhy && (
        <div
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 14,
            fontSize: 13,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>Why this is on the board</p>
          {rec.storyWhat && (
            <p style={{ margin: 0 }}>
              <strong>What:</strong> {rec.storyWhat}
            </p>
          )}
          {rec.storyWhy && (
            <p style={{ margin: 0 }}>
              <strong>Why:</strong> {rec.storyWhy}
            </p>
          )}
          {rec.storyWhyNow && (
            <p style={{ margin: 0 }}>
              <strong>Why now:</strong> {rec.storyWhyNow}
            </p>
          )}
          {rec.storyExpectedResult && (
            <p style={{ margin: 0 }}>
              <strong>Expected result:</strong> {rec.storyExpectedResult}
            </p>
          )}
          <p style={{ margin: 0, color: "var(--muted)" }}>
            {rec.confidenceNarrative ?? rec.confidence}
          </p>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
            Official management order. Unlike economic families are not a cash leaderboard. Capacity is
            respected via OEC — not padded.
          </p>
        </div>
      )}

      {form && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 12,
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
                <textarea
                  value={progress}
                  onChange={(e) => setProgress(e.target.value)}
                  style={{ ...inputStyle, minHeight: 60 }}
                />
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
            <button type="button" style={ghostBtn} onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 15 }}>{value}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text)",
  boxSizing: "border-box",
};
