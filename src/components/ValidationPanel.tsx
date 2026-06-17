"use client";

import { useState } from "react";
import Link from "next/link";
import type { AcceptanceItem, ValidationReport } from "@/lib/iam/validation/types";

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

function statusColor(status: string): string {
  if (status === "pass" || status === "Pass") return "var(--accent)";
  if (status === "fail" || status === "Fail - Correction Required") return "var(--bad)";
  if (status === "skip") return "var(--muted)";
  return "var(--warn)";
}

export function ValidationPanel({
  initialReport,
  initialChecklist,
  validationRunId,
}: {
  initialReport: ValidationReport;
  initialChecklist: AcceptanceItem[];
  validationRunId: string | null;
}) {
  const [report, setReport] = useState(initialReport);
  const [checklist, setChecklist] = useState(initialChecklist);
  const [runId, setRunId] = useState(validationRunId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function runValidation(integration: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/validation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integration, runId: runId ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "Validation failed");
        return;
      }
      setReport(data.report);
      setChecklist(data.checklist);
      if (data.validationRunId) setRunId(data.validationRunId);
      setMsg(`Completed — ${data.report.summary.pass} pass, ${data.report.summary.fail} fail`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 10 }}>
        <button type="button" style={primaryBtn} disabled={busy} onClick={() => runValidation(true)}>
          Run full validation (unit + integration)
        </button>
        <button type="button" style={btn} disabled={busy} onClick={() => runValidation(false)}>
          Unit tests only
        </button>
      </section>

      {msg && <p style={{ marginTop: 12, fontSize: 13, color: "var(--accent)" }}>{msg}</p>}

      <section
        style={{
          marginTop: 24,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        {[
          ["Pass", report.summary.pass, "var(--accent)"],
          ["Fail", report.summary.fail, "var(--bad)"],
          ["Skip", report.summary.skip, "var(--muted)"],
          ["Total", report.summary.total, "var(--text)"],
        ].map(([label, val, color]) => (
          <div
            key={String(label)}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "14px 16px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, color: String(color) }}>{val}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </section>

      <p style={{ marginTop: 16, fontSize: 13, color: "var(--muted)" }}>
        Readiness: <strong style={{ color: "var(--text)" }}>{report.readinessLevel}</strong>
        {" · "}
        UAT workbook: {report.uatWorkbookPresent ? "present" : "missing — run npm run docs:extract"}
        {runId && (
          <>
            {" · "}
            <Link href={`/runs/${runId}`} style={{ color: "var(--accent)" }}>
              Open validation run
            </Link>
          </>
        )}
      </p>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18 }}>Doc 07 / 08 validation cases</h2>
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {report.cases.map((c) => (
            <div
              key={c.id}
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <strong>
                  {c.id} — {c.name}
                </strong>
                <span style={{ color: statusColor(c.status), textTransform: "uppercase", fontSize: 11 }}>
                  {c.status}
                </span>
              </div>
              <div style={{ color: "var(--muted)", marginTop: 4 }}>
                {c.area} · {c.docRef}
              </div>
              <div style={{ marginTop: 4 }}>{c.message}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18 }}>Developer acceptance checklist (doc 08)</h2>
        <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
          {checklist.map((item) => (
            <div
              key={item.id}
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr 160px",
                gap: 12,
                fontSize: 13,
                padding: "8px 12px",
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <span style={{ color: "var(--muted)" }}>{item.category}</span>
              <span>{item.requirement}</span>
              <span style={{ color: statusColor(item.status), textAlign: "right" }}>{item.status}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
