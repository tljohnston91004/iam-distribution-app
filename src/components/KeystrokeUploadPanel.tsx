"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Slot = {
  key: string;
  label: string;
  required: boolean;
  status: "ok" | "missing" | "optional_missing";
  filenames: string[];
  rowCount: number;
};

type ChecklistState = {
  slots: Slot[];
  readyToMerge: boolean;
  warnings: string[];
  alreadyMerged?: boolean;
  hasStagedOverrides?: boolean;
  batchCount?: number;
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

function statusLabel(status: Slot["status"]) {
  if (status === "ok") return { text: "Ready", color: "var(--accent)" };
  if (status === "missing") return { text: "Required", color: "var(--bad)" };
  return { text: "Optional", color: "var(--muted)" };
}

export function KeystrokeUploadPanel({
  runId,
  onMerged,
}: {
  runId: string;
  onMerged?: (counts: { inventory: number; demand: number; supply: number }) => void;
}) {
  const router = useRouter();
  const [checklist, setChecklist] = useState<ChecklistState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgIsError, setMsgIsError] = useState(false);

  async function refresh() {
    const res = await fetch(`/api/runs/${runId}/keystroke`);
    if (!res.ok) return;
    const data = await res.json();
    setChecklist({
      slots: data.slots,
      readyToMerge: Boolean(data.readyToMerge),
      warnings: data.warnings ?? [],
      alreadyMerged: Boolean(data.alreadyMerged),
      hasStagedOverrides: Boolean(data.hasStagedOverrides),
      batchCount: (data.batches ?? []).length,
    });
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [runId]);

  async function upload(file: File) {
    setBusy(true);
    setMsg(null);
    setMsgIsError(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("fileType", "auto");
      const res = await fetch(`/api/runs/${runId}/keystroke`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsgIsError(true);
        setMsg(data.error ?? "Upload failed");
        return;
      }
      setChecklist({
        slots: data.checklist?.slots ?? data.slots,
        readyToMerge: Boolean(data.checklist?.readyToMerge ?? data.readyToMerge),
        warnings: data.checklist?.warnings ?? data.warnings ?? [],
        alreadyMerged: Boolean(data.checklist?.alreadyMerged ?? data.alreadyMerged),
        hasStagedOverrides: Boolean(
          data.checklist?.hasStagedOverrides ?? data.hasStagedOverrides
        ),
        batchCount: (data.checklist?.batches ?? data.batches ?? []).length,
      });
      setMsg(
        `Staged ${data.rowCount} rows from ${data.filename} as ${data.fileType}${
          data.demandVariant ? ` (${data.demandVariant})` : ""
        }`
      );
    } catch (err) {
      setMsgIsError(true);
      setMsg(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function merge() {
    setBusy(true);
    setMsg(null);
    setMsgIsError(false);
    try {
      const res = await fetch(`/api/runs/${runId}/merge`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsgIsError(true);
        setMsg(data.error ?? "Merge failed");
        return;
      }
      setMsg(
        `Merged: ${data.inventorySkus} inventory SKUs · ${data.demandSkus} demand SKUs` +
          (data.excludedParentSkuCount
            ? ` · ${data.excludedParentSkuCount} matrix parent/scheme SKUs excluded`
            : "")
      );
      onMerged?.({
        inventory: data.inventorySkus ?? 0,
        demand: data.demandSkus ?? 0,
        supply: data.supplySkus ?? 0,
      });
      await refresh();
      router.refresh();
    } catch (err) {
      setMsgIsError(true);
      setMsg(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      style={{
        marginTop: 20,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "16px 18px",
      }}
    >
      <h2 style={{ fontSize: 16, margin: 0 }}>Keystroke upload checklist</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "8px 0 0" }}>
        Upload inventory + split 13-week demand (Standard and/or Matrix), then merge into the run before
        Calculate &amp; rank — same idea as RSE.
      </p>

      <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <label style={{ ...primaryBtn, display: "inline-block", opacity: busy ? 0.6 : 1 }}>
          Upload Keystroke file
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            style={{ display: "none" }}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          style={primaryBtn}
          disabled={busy || !checklist?.readyToMerge}
          onClick={merge}
          title={
            checklist?.readyToMerge
              ? checklist.alreadyMerged
                ? "Re-merge staged/merged files into the run"
                : "Merge staged files into the run"
              : "Upload inventory plus at least one 13-week True Demand Replenishment file first"
          }
        >
          {checklist?.alreadyMerged ? "Re-merge uploads into run" : "Merge uploads into run"}
        </button>
        {checklist?.alreadyMerged && checklist.readyToMerge ? (
          <span style={{ color: "var(--accent)", fontSize: 12, maxWidth: 480 }}>
            These files are <strong>already merged</strong> into this run. You do not need Inventory
            Classification. Next: <strong>Approve evidence</strong> (if prompted) →{" "}
            <strong>Calculate · Score · Present</strong>. Or re-merge if you want to refresh evidence.
          </span>
        ) : checklist?.hasStagedOverrides && checklist.readyToMerge ? (
          <span style={{ color: "var(--accent)", fontSize: 12, maxWidth: 480 }}>
            New uploads are combined with previously merged files for other slots. Click{" "}
            <strong>Merge</strong> to apply the full set into the run.
          </span>
        ) : checklist?.readyToMerge ? (
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            Safe to merge — Inventory Classification is optional and can be skipped.
          </span>
        ) : checklist ? (
          <span style={{ color: "var(--warn)", fontSize: 12, maxWidth: 420 }}>
            Merge is locked until you have: (1) Inventory (SCBSRSE3 or INVENTORYPOSITION) and (2) at
            least one 13-week True Demand <strong>Replenishment</strong> file (Standard and/or
            Matrix). Classification files are optional and do not unlock merge by themselves.
          </span>
        ) : null}
      </div>

      {msg && (
        <p
          style={{
            marginTop: 10,
            fontSize: 13,
            color: msgIsError ? "var(--bad)" : "var(--accent)",
            fontWeight: msgIsError ? 600 : 400,
          }}
        >
          {msg}
        </p>
      )}

      <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
        {(checklist?.slots ?? []).map((slot) => {
          const st = statusLabel(slot.status);
          return (
            <div
              key={slot.key}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--panel-2)",
                fontSize: 13,
              }}
            >
              <div>
                <strong>{slot.label}</strong>
                <div style={{ color: "var(--muted)", marginTop: 4 }}>
                  {slot.filenames.length
                    ? `${slot.filenames.join(", ")} · ${slot.rowCount} rows`
                    : slot.required
                      ? "Not uploaded yet"
                      : "Not uploaded (optional)"}
                </div>
              </div>
              <span style={{ color: st.color, fontWeight: 600, alignSelf: "center" }}>{st.text}</span>
            </div>
          );
        })}
        {!checklist && (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading checklist…</p>
        )}
      </div>

      {checklist?.warnings?.length ? (
        <ul style={{ marginTop: 12, color: "var(--warn)", fontSize: 12, paddingLeft: 18 }}>
          {checklist.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
