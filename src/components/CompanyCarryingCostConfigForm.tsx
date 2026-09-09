"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CARRYING_COST_RATE_SOURCES,
  type CarryingCostRateSource,
} from "@/lib/iam/company/carrying-cost-rate-shared";

type Config = {
  companyId: string;
  companyName: string;
  annualCarryingCostRate: number | null;
  displayPercent: number | null;
  effectiveDate: string | null;
  source: string | null;
  configurationNote: string | null;
  requiredPermission: string;
  lastUpdatedBy: string | null;
  lastUpdatedAt: string | null;
  maxAllowedRate: number;
};

type HistoryRow = {
  id: string;
  performedBy: string;
  performedAt: string;
  detail: string | null;
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

const field: React.CSSProperties = {
  width: "100%",
  padding: 8,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 13,
};

export function CompanyCarryingCostConfigForm({
  companyId,
  returnHref,
  performedByDefault = "executive",
  iamRunId,
  compact = false,
}: {
  companyId: string;
  returnHref?: string;
  performedByDefault?: string;
  iamRunId?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [config, setConfig] = useState<Config | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [ratePercent, setRatePercent] = useState("24");
  const [source, setSource] = useState<CarryingCostRateSource>("Management-approved assumption");
  const [note, setNote] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/companies/${companyId}/carrying-cost-rate`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Load failed");
    setConfig(data.config);
    setHistory(data.history ?? []);
    if (data.config?.displayPercent != null) setRatePercent(String(data.config.displayPercent));
    if (data.config?.source) setSource(data.config.source);
    if (data.config?.configurationNote) setNote(data.config.configurationNote);
    if (data.config?.effectiveDate) setEffectiveDate(data.config.effectiveDate);
  }

  useEffect(() => {
    load().catch((e) => setErr(e instanceof Error ? e.message : "Load failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function save() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/carrying-cost-rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ratePercent: Number(ratePercent),
          source,
          configurationNote: note,
          effectiveDate,
          performedBy: performedByDefault,
          iamRunId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setConfig(data.config);
      setHistory(data.history ?? []);
      setMsg(
        `Saved Annual Inventory Carrying-Cost Rate: ${data.config.displayPercent}% (${data.config.annualCarryingCostRate})`
      );
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id="carrying-cost-rate"
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: compact ? 14 : 20,
      }}
    >
      <h2 style={{ margin: "0 0 6px", fontSize: compact ? 15 : 18 }}>
        Annual Inventory Carrying-Cost Rate
      </h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
        Per-company configuration used for Cost of Inaction. Stored as a decimal (e.g. 0.24); displayed as a
        percentage (e.g. 24%). Required permission:{" "}
        <code>{config?.requiredPermission ?? "company_financial_config"}</code>.
      </p>

      {config && (
        <p style={{ margin: "0 0 12px", fontSize: 13 }}>
          Current:{" "}
          <strong>
            {config.displayPercent != null ? `${config.displayPercent}%` : "Not configured"}
          </strong>
          {config.annualCarryingCostRate != null ? ` (decimal ${config.annualCarryingCostRate})` : ""}
          {config.source ? ` · Source: ${config.source}` : ""}
          {config.lastUpdatedBy
            ? ` · Last updated by ${config.lastUpdatedBy}${
                config.lastUpdatedAt ? ` on ${config.lastUpdatedAt.slice(0, 10)}` : ""
              }`
            : ""}
        </p>
      )}

      <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
        <label style={{ fontSize: 12 }}>
          Rate (%)
          <input
            type="number"
            min={0}
            max={(config?.maxAllowedRate ?? 1) * 100}
            step={0.01}
            value={ratePercent}
            onChange={(e) => setRatePercent(e.target.value)}
            style={{ ...field, marginTop: 4 }}
            aria-label="Annual Inventory Carrying-Cost Rate percent"
          />
        </label>
        <label style={{ fontSize: 12 }}>
          Source / basis
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as CarryingCostRateSource)}
            style={{ ...field, marginTop: 4 }}
            aria-label="Carrying-cost rate source"
          >
            {CARRYING_COST_RATE_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Effective date
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            style={{ ...field, marginTop: 4 }}
          />
        </label>
        <label style={{ fontSize: 12 }}>
          Configuration note
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={compact ? 2 : 3}
            style={{ ...field, marginTop: 4 }}
            placeholder="Basis for the approved rate (e.g. interim management-approved assumption for pilot)"
          />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={primaryBtn} disabled={busy} onClick={save}>
            Save carrying-cost rate
          </button>
          {returnHref && (
            <Link href={returnHref} style={{ ...btn, textDecoration: "none", display: "inline-block" }}>
              Back
            </Link>
          )}
        </div>
      </div>

      {msg && <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--accent)" }}>{msg}</p>}
      {err && <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--bad)" }}>{err}</p>}

      {!compact && history.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Audit history</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--muted)" }}>
            {history.map((h) => (
              <li key={h.id}>
                {h.performedAt.slice(0, 19).replace("T", " ")} · {h.performedBy}
                {h.detail ? ` — ${h.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
