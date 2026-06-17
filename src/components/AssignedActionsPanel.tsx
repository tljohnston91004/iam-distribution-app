"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { shortDate } from "@/lib/format";

type ActionRow = {
  id: string;
  actionTitle: string;
  workflowState: string;
  dueDate: string | null;
  reviewDate: string | null;
  actionType: string;
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

export function AssignedActionsPanel({
  runId,
  actions,
  ownerFilter,
}: {
  runId: string;
  actions: ActionRow[];
  ownerFilter: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function accept(actionId: string) {
    setBusy(actionId);
    try {
      const res = await fetch(`/api/actions/${actionId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toState: "Active",
          ownerName: ownerFilter,
          ownerRole: "inventory_manager",
          dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
          reviewDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (actions.length === 0) {
    return (
      <p style={{ marginTop: 24, color: "var(--muted)", fontSize: 14 }}>
        No assigned actions for {ownerFilter}. Approve featured priorities on the management dashboard first.
      </p>
    );
  }

  return (
    <section style={{ marginTop: 24 }}>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Next step: acknowledge ownership and update progress on active work.
      </p>
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {actions.map((a) => (
          <div
            key={a.id}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "14px 18px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <strong>{a.actionTitle}</strong>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>{a.workflowState}</span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
              {a.actionType}
              {a.dueDate && ` · Due ${shortDate(a.dueDate)}`}
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <Link href={`/runs/${runId}/actions/${a.id}?viewAs=owner`} style={{ ...btn, textDecoration: "none" }}>
                Open action
              </Link>
              {a.workflowState === "Awaiting Acceptance" && (
                <button type="button" style={btn} disabled={busy === a.id} onClick={() => accept(a.id)}>
                  Accept & start
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
