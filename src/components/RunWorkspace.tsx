"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { usd } from "@/lib/format";
import type { RunBanner } from "@/lib/iam/banners";
import { KeystrokeUploadPanel } from "@/components/KeystrokeUploadPanel";

type ActionRow = {
  id: string;
  actionTitle: string;
  actionType: string;
  actionStrength: string;
  priorityScore: number;
  workflowState: string;
  featuredSlot: number | null;
  priorityCategory: string;
  ownerRole: string | null;
  ownerName: string | null;
  confidenceLevel: string;
  originalEstimatedImpact: number | null;
};

type RunData = {
  id: string;
  runName: string;
  runStatus: string;
  cycleStatus: string;
  readinessStatus: string;
  company: { name: string };
  reviewWeekStart: string;
  reviewWeekEnd: string;
  actions: ActionRow[];
  actionCandidates: { id: string; candidateTitle: string; priorityScore: number; rankedPosition: number | null; suppressedFlag: boolean }[];
  dataGaps: { gapDescription: string; affectedArea: string }[];
  moduleSignals: { sourceModule: string; signalType: string; skuOrItemId: string | null }[];
  _count: { inventorySnapshots: number; demandHistory: number; incomingSupply: number };
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

export function RunWorkspace({
  run,
  banners = [],
  nextAction = "",
  holdovers = [],
  managementPriority = [],
}: {
  run: RunData;
  banners?: RunBanner[];
  nextAction?: string;
  holdovers?: ActionRow[];
  managementPriority?: ActionRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgIsError, setMsgIsError] = useState(false);
  const [counts, setCounts] = useState(run._count);

  const featured = run.actions
    .filter((a) => a.featuredSlot != null && a.featuredSlot <= 2)
    .sort((a, b) => (a.featuredSlot ?? 99) - (b.featuredSlot ?? 99));
  const holdoverItems = holdovers.length ? holdovers : run.actions.filter((a) => a.workflowState === "Holdover");
  const candidates = run.actions.filter((a) => a.workflowState === "Candidate");

  async function upload(file: File) {
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("sourceSystem", "spreadsheet");
    const res = await fetch(`/api/runs/${run.id}/upload`, { method: "POST", body: fd });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMsg(data.error ?? "Upload failed");
      return;
    }
    setMsg(`Uploaded ${data.rowCount} ${data.domain} rows`);
    router.refresh();
  }

  async function approveEvidence() {
    setBusy(true);
    setMsg(null);
    setMsgIsError(false);
    try {
      const res = await fetch(`/api/runs/${run.id}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", performedBy: "operator" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsgIsError(true);
        setMsg(data.error ?? "Approve evidence failed");
        return;
      }
      setMsg("Evidence approved for analysis — Calculate is unlocked");
      router.refresh();
    } catch (err) {
      setMsgIsError(true);
      setMsg(err instanceof Error ? err.message : "Could not reach server");
    } finally {
      setBusy(false);
    }
  }

  async function calculate() {
    setBusy(true);
    setMsg(null);
    setMsgIsError(false);
    const res = await fetch(`/api/runs/${run.id}/calculate`, { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMsgIsError(true);
      setMsg(data.error ?? "Calculate failed");
      return;
    }
    setMsg(`${data.featuredCount} featured of ${data.candidateCount} candidates`);
    router.refresh();
  }

  async function loadSampleData() {
    setBusy(true);
    setMsg(null);
    setMsgIsError(false);
    try {
      const res = await fetch("/api/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsgIsError(true);
        setMsg(data.error ?? `Load failed (${res.status})`);
        return;
      }
      setCounts({
        inventorySnapshots: data.inventoryCount ?? data.loaded ?? 0,
        demandHistory: data.demandCount ?? data.loaded ?? 0,
        incomingSupply: data.supplyCount ?? 1,
      });
      setMsg(
        `Loaded ${data.loaded ?? 4} sample SKUs (${data.inventoryCount ?? 4} inventory, ${data.demandCount ?? 4} demand)`
      );
      router.refresh();
    } catch (err) {
      setMsgIsError(true);
      setMsg(err instanceof Error ? err.message : "Could not reach server — is Start IAM.bat running?");
    } finally {
      setBusy(false);
    }
  }
  async function loadValidationScenarios() {
    setBusy(true);
    setMsg(null);
    setMsgIsError(false);
    try {
      const res = await fetch("/api/seed/validation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsgIsError(true);
        setMsg(data.error ?? "Validation seed failed");
        return;
      }
      setCounts({
        inventorySnapshots: 7,
        demandHistory: 7,
        incomingSupply: 2,
      });
      setMsg(data.message ?? "Validation scenarios loaded and ranked");
      router.refresh();
    } catch (err) {
      setMsgIsError(true);
      setMsg(err instanceof Error ? err.message : "Could not reach server");
    } finally {
      setBusy(false);
    }
  }

  async function loadSampleSignals() {
    setBusy(true);
    setMsg(null);
    setMsgIsError(false);
    try {
      const res = await fetch(`/api/runs/${run.id}/import-signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signals: [
            {
              sourceModule: "RSE",
              signalType: "min_max_issue_flag",
              signalCategory: "Advisory",
              skuOrItemId: "SKU-100",
              summary: "Min/Max likely mis-set",
            },
            {
              sourceModule: "IFM",
              signalType: "cash_pressure_flag",
              signalCategory: "Advisory",
              summary: "Elevated cash pressure this week",
              payload: { low: true },
            },
          ],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsgIsError(true);
        setMsg(data.error ?? "Signal import failed");
        return;
      }
      setMsg(`Sample RSE/IFM signals imported (${data.imported ?? 0})`);
      router.refresh();
    } catch (err) {
      setMsgIsError(true);
      setMsg(err instanceof Error ? err.message : "Could not reach server");
    } finally {
      setBusy(false);
    }
  }

  async function transition(actionId: string, toState: string) {
    setBusy(true);
    const res = await fetch(`/api/actions/${actionId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toState,
        ownerRole: "inventory_manager",
        ownerName: "Pilot Manager",
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        reviewDate: new Date(Date.now() + 7 * 86400000).toISOString(),
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMsg(data.error ?? "Transition failed");
      return;
    }
    setMsg(`Action → ${toState}`);
    router.refresh();
  }

  return (
    <>
      {msg && (
        <p
          style={{
            marginTop: 12,
            fontSize: 13,
            color: msgIsError ? "var(--bad)" : "var(--accent)",
            fontWeight: msgIsError ? 600 : 400,
          }}
        >
          {msg}
        </p>
      )}

      <KeystrokeUploadPanel
        runId={run.id}
        onMerged={(c) =>
          setCounts({
            inventorySnapshots: c.inventory,
            demandHistory: c.demand,
            incomingSupply: c.supply,
          })
        }
      />

      <section
        style={{
          marginTop: 20,
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
        }}
      >
        <label style={{ ...btn, display: "inline-block" }}>
          Upload inventory / demand file (simple)
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            style={{ display: "none" }}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
            }}
          />
        </label>
        <button type="button" style={btn} disabled={busy} onClick={approveEvidence}>
          Approve evidence
        </button>
        <button type="button" style={primaryBtn} disabled={busy} onClick={calculate}>
          Calculate & rank
        </button>
        <button type="button" style={btn} disabled={busy} onClick={loadSampleSignals}>
          Import sample RSE/IFM signals
        </button>
        <button type="button" style={btn} disabled={busy} onClick={loadSampleData}>
          Load sample data
        </button>
        <button type="button" style={btn} disabled={busy} onClick={loadValidationScenarios}>
          Load validation scenarios
        </button>
      </section>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8, maxWidth: 720 }}>
        Prefer the <strong>Keystroke upload checklist</strong> above for multi-file Matrix + Standard.
        After merge or upload, <strong>Approve evidence</strong> before Calculate. All sources
        (customer upload, Keystroke, RSE, Data Hub) share one ingestion path.
      </p>

      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 10 }}>
        Intake: {counts.inventorySnapshots} inventory · {counts.demandHistory} demand ·{" "}
        {counts.incomingSupply} supply · Readiness: {run.readinessStatus}
      </p>

      {nextAction && (
        <section
          style={{
            marginTop: 12,
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "12px 16px",
            fontSize: 13,
          }}
        >
          <strong>Next best action:</strong> {nextAction}
        </section>
      )}

      {banners.map((b, i) => (
        <section
          key={i}
          style={{
            marginTop: 10,
            background: b.level === "warn" ? "rgba(242,181,60,0.12)" : "var(--panel)",
            border: `1px solid ${b.level === "warn" ? "var(--warn)" : "var(--border)"}`,
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
            color: b.level === "warn" ? "var(--warn)" : "var(--muted)",
          }}
        >
          {b.message}
        </section>
      ))}

      <section style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 12, fontSize: 13 }}>
        <a href={`/api/runs/${run.id}/export?type=management`} style={{ color: "var(--accent)" }}>
          Export management summary (CSV)
        </a>
        <a href={`/api/runs/${run.id}/export?type=tracker`} style={{ color: "var(--accent)" }}>
          Export action tracker (CSV)
        </a>
      </section>

      {featured.length > 0 && (
        <section
          style={{
            marginTop: 16,
            background: "var(--panel)",
            border: "1px solid var(--accent)",
            borderRadius: 10,
            padding: "14px 18px",
          }}
        >
          <strong>{featured.length} featured priorit{featured.length === 1 ? "y" : "ies"} ready for review</strong>
          <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 0" }}>
            Scroll down or use <strong>Open & review</strong> on each card below.
          </p>
        </section>
      )}

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 18 }}>Featured priorities (top 2)</h2>
        {featured.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Upload data, then Calculate & rank.</p>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {featured.map((item) => (
              <div
                key={item.id}
                style={{
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "14px 18px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <strong>
                    #{item.featuredSlot} — {item.actionTitle}
                  </strong>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>{item.workflowState}</span>
                </div>
                <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                  {item.actionStrength} · {item.actionType} · Score {item.priorityScore.toFixed(1)} ·{" "}
                  {usd(item.originalEstimatedImpact)} · {item.confidenceLevel}
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link
                    href={`/runs/${run.id}/actions/${item.id}`}
                    style={{
                      ...primaryBtn,
                      display: "inline-block",
                      textDecoration: "none",
                      pointerEvents: busy ? "none" : "auto",
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    Open & review
                  </Link>
                  <button type="button" style={btn} disabled={busy} onClick={() => transition(item.id, "Approved")}>
                    Approve
                  </button>
                  <button
                    type="button"
                    style={btn}
                    disabled={busy}
                    onClick={() => transition(item.id, "Rejected for Cycle")}
                  >
                    Reject for cycle
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginTop: 28, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 18 }}>Holdovers ({holdoverItems.length})</h2>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Ranked separately from new priorities</p>
          {holdoverItems.slice(0, 5).map((h) => (
            <div key={h.id} style={{ fontSize: 13, marginTop: 8 }}>
              <Link href={`/runs/${run.id}/actions/${h.id}`} style={{ color: "var(--accent)" }}>
                {h.actionTitle}
              </Link>
            </div>
          ))}
        </div>
        <div>
          <h2 style={{ fontSize: 18 }}>Lower queue ({candidates.length})</h2>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Does not auto-backfill rejected featured slots</p>
        </div>
      </section>

      {managementPriority.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18 }}>Management-priority items</h2>
          {managementPriority.map((m) => (
            <div key={m.id} style={{ fontSize: 13, marginTop: 8 }}>
              <Link href={`/runs/${run.id}/actions/${m.id}`} style={{ color: "var(--accent)" }}>
                {m.actionTitle}
              </Link>
            </div>
          ))}
        </section>
      )}

      {run.dataGaps.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18 }}>Data gaps</h2>
          <ul style={{ color: "var(--muted)", fontSize: 13 }}>
            {run.dataGaps.map((g, i) => (
              <li key={i}>
                {g.affectedArea}: {g.gapDescription}
              </li>
            ))}
          </ul>
        </section>
      )}

      {run.moduleSignals.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18 }}>Module signals</h2>
          <ul style={{ color: "var(--muted)", fontSize: 13 }}>
            {run.moduleSignals.map((s, i) => (
              <li key={i}>
                {s.sourceModule}: {s.signalType} {s.skuOrItemId ? `(${s.skuOrItemId})` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
