"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BoardRecommendation } from "@/lib/iam/board/types";
import { requiredActionHint } from "@/lib/iam/board/types";

const btn: React.CSSProperties = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 12px",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 13,
};

export function AssignedRecommendationsPanel({
  runId,
  items,
  ownerFilter,
}: {
  runId: string;
  items: BoardRecommendation[];
  ownerFilter: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function accept(id: string, ownerUserId: string | null) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/recommendations/${id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", ownerUserId: ownerUserId ?? undefined, performedBy: ownerFilter }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Accept failed");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Accept failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      {msg && <p style={{ color: "var(--bad)", fontSize: 13 }}>{msg}</p>}
      {items.length === 0 && (
        <p style={{ color: "var(--muted)" }}>No open recommendations assigned to {ownerFilter}.</p>
      )}
      {items.map((r) => (
        <article
          key={r.id}
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>{r.title}</h3>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            {r.lifecycleState} · {r.presentationCategory} · Score {r.priorityScore?.toFixed(1) ?? "—"}
          </p>
          <p style={{ margin: "8px 0", fontSize: 13, color: "var(--accent)" }}>
            {requiredActionHint(r.lifecycleState, r.presentationCategory)}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href={`/runs/${runId}/recommendations/${r.id}?viewAs=owner`} style={{ ...btn, textDecoration: "none" }}>
              Open
            </Link>
            {r.lifecycleState === "Awaiting Acceptance" && (
              <button type="button" style={btn} disabled={busy} onClick={() => accept(r.id, r.ownerUserId)}>
                Accept &amp; start
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
