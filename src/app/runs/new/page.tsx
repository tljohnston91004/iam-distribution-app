"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const field: React.CSSProperties = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "9px 12px",
  color: "var(--text)",
  width: "100%",
};
const labelStyle: React.CSSProperties = { fontSize: 13, color: "var(--muted)", display: "block", marginBottom: 4 };

export default function NewRunPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    companyName: "",
    runName: "Weekly Inventory Action Review",
    reviewWeekStart: "2026-06-16",
    reviewWeekEnd: "2026-06-22",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 24px" }}>
      <Link href="/" style={{ fontSize: 13, color: "var(--muted)" }}>
        ← All runs
      </Link>
      <h1 style={{ fontSize: 24, margin: "8px 0 4px" }}>New IAM Run Setup</h1>
      <p style={{ color: "var(--muted)", marginTop: 0, fontSize: 14 }}>
        One company per workspace, one weekly operating rhythm. Data upload and scoring come next.
      </p>

      <form
        style={{ display: "grid", gap: 14, marginTop: 16 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          try {
            const res = await fetch("/api/runs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(form),
            });
            const data = await res.json();
            if (data.runId) router.push(`/runs/${data.runId}`);
            else throw new Error(data.error ?? "Create failed");
          } catch (err) {
            alert(err instanceof Error ? err.message : "Create failed");
            setLoading(false);
          }
        }}
      >
        <div>
          <label style={labelStyle}>Company name</label>
          <input style={field} value={form.companyName} onChange={set("companyName")} required placeholder="e.g. Pilot Distributor" />
        </div>
        <div>
          <label style={labelStyle}>Run name</label>
          <input style={field} value={form.runName} onChange={set("runName")} required />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>Review week start</label>
            <input style={field} type="date" value={form.reviewWeekStart} onChange={set("reviewWeekStart")} />
          </div>
          <div>
            <label style={labelStyle}>Review week end</label>
            <input style={field} type="date" value={form.reviewWeekEnd} onChange={set("reviewWeekEnd")} />
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          style={{
            background: "var(--accent)",
            color: "#04122a",
            border: "none",
            borderRadius: 8,
            padding: "11px 16px",
            fontWeight: 600,
            cursor: "pointer",
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Creating…" : "Create run"}
        </button>
      </form>
    </main>
  );
}
