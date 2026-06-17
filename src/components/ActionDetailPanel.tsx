"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getAllowedTransitions } from "@/lib/iam/workflow-transitions";
import type { ActionWorkflowState } from "@/lib/iam/enums";

const btn: React.CSSProperties = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "9px 16px",
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

export function ActionDetailPanel({
  actionId,
  runId,
  workflowState,
  ownerRole,
  ownerName,
  viewAs = "management",
  groupedItems = [],
}: {
  actionId: string;
  runId: string;
  workflowState: string;
  ownerRole: string | null;
  ownerName: string | null;
  viewAs?: "management" | "owner";
  groupedItems?: { id: string; childReferenceId: string; childStatus: string; childNote: string | null }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const transitions = getAllowedTransitions(workflowState as ActionWorkflowState);
  const isManagement = viewAs === "management";

  async function transition(toState: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/actions/${actionId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toState,
          ownerRole: ownerRole ?? "inventory_manager",
          ownerName: ownerName ?? "Pilot Manager",
          dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
          reviewDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error ?? "Update failed");
        return;
      }
      setMsg(`Updated → ${toState}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/actions/${actionId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteText, createdBy: viewAs }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMsg(data.error ?? "Note failed");
        return;
      }
      setNoteText("");
      setMsg("Management note saved");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {groupedItems.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16 }}>Grouped action — child items</h2>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            One business case, one owner, one action type. Partial resolution shown below.
          </p>
          <ul style={{ fontSize: 13, color: "var(--muted)" }}>
            {groupedItems.map((c) => (
              <li key={c.id}>
                {c.childReferenceId} — {c.childStatus}
                {c.childNote ? ` (${c.childNote})` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 16 }}>{isManagement ? "Management review" : "Your action"}</h2>
        {transitions.length > 0 ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {transitions.map((t) => (
              <button
                key={t.state}
                type="button"
                style={t.state === "Approved" || t.state === "Active" ? primaryBtn : btn}
                disabled={busy || (!isManagement && t.state === "Rejected for Cycle")}
                onClick={() => transition(t.state)}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            No further transitions — archived/completed actions never reopen.
          </p>
        )}
      </section>

      {isManagement && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16 }}>Management-only note</h2>
          <p style={{ color: "var(--muted)", fontSize: 12 }}>
            Protected — not shown in ordinary exports or owner view.
          </p>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={3}
            style={{
              width: "100%",
              marginTop: 8,
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 10,
              color: "var(--text)",
              fontSize: 13,
            }}
            placeholder="Internal management context..."
          />
          <button type="button" style={{ ...btn, marginTop: 8 }} disabled={busy} onClick={addNote}>
            Save protected note
          </button>
        </section>
      )}

      {msg && <p style={{ marginTop: 12, fontSize: 13, color: "var(--accent)" }}>{msg}</p>}

      <p style={{ marginTop: 16, fontSize: 13 }}>
        <a href={`/runs/${runId}`} style={{ color: "var(--accent)" }}>
          Return to management dashboard
        </a>
      </p>
    </>
  );
}
