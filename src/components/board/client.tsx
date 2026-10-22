"use client";
/**
 * Stage 4D board controls. Every control gives immediate feedback: it is disabled and shows a spinner and "...ing" text the moment it
 * is pressed, then shows the outcome (success or the exact refusal code and message). No control is inert, and none of them scores.
 */
import { useRouter } from "next/navigation";
import { useState, type CSSProperties, type ReactNode } from "react";

export const NAVY = "#0b2a5b";
export const buttonStyle = (disabled = false): CSSProperties => ({
  background: disabled ? "#5b6f93" : NAVY,
  color: "#ffffff",
  border: "1px solid #08204a",
  borderRadius: 8,
  padding: "9px 16px",
  fontWeight: 600,
  fontSize: 14,
  cursor: disabled ? "progress" : "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  whiteSpace: "nowrap",
});

function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", display: "inline-block", animation: "iamspin 0.8s linear infinite" }}
    />
  );
}

export function SpinKeyframes() {
  return <style>{`@keyframes iamspin{to{transform:rotate(360deg)}}`}</style>;
}

type Outcome = { kind: "success" | "error"; text: string; detail?: string } | null;

function OutcomeLine({ outcome }: { outcome: Outcome }) {
  if (!outcome) return null;
  const good = outcome.kind === "success";
  return (
    <div
      role={good ? "status" : "alert"}
      style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, fontSize: 13, background: good ? "var(--ryg-green-bg)" : "var(--ryg-red-bg)", color: good ? "var(--good)" : "var(--bad)", border: `1px solid ${good ? "#a9d9bc" : "#f0b7b7"}` }}
    >
      <strong>{good ? "Done. " : "Not done. "}</strong>
      {outcome.text}
      {outcome.detail ? <div style={{ color: "var(--muted)", marginTop: 4 }}>{outcome.detail}</div> : null}
    </div>
  );
}

async function post(url: string, body?: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

const errorText = (json: Record<string, unknown>, status: number): { text: string; detail: string } => {
  const e = json.error as { code?: string; message?: string } | undefined;
  if (e?.message) return { text: e.message, detail: e.code ? `Reference: ${e.code}` : "" };
  const msg = typeof json.failureReason === "string" ? json.failureReason : `The request failed (HTTP ${status}).`;
  return { text: msg, detail: typeof json.failureCode === "string" ? `Reference: ${json.failureCode}` : "" };
};

/** "Refresh from Data Hub": the Stage 4A backend refresh. It reads and stores data only; scoring is NOT run. */
export function RefreshFromDataHub() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  async function run() {
    setBusy(true);
    setOutcome(null);
    try {
      const r = await post("/api/dpos/refresh");
      if (r.ok) {
        // Times are never formatted in the browser's zone; the freshness block above is rendered on the server in the company time zone.
        setOutcome({ kind: "success", text: "Data Hub data refreshed. The data-current-through time above is shown in the company time zone.", detail: "Pending Next Scoring Run: scores are not recalculated by a refresh; the calculated scores shown stay as they were until the next scoring run." });
        router.refresh();
      } else {
        const e = errorText(r.json, r.status);
        setOutcome({ kind: "error", text: e.text, detail: e.detail });
        router.refresh();
      }
    } catch (err) {
      setOutcome({ kind: "error", text: err instanceof Error ? err.message : "The refresh could not be reached." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <SpinKeyframes />
      <button type="button" onClick={run} disabled={busy} aria-busy={busy} aria-pressed={busy} data-testid="refresh-from-datahub" style={buttonStyle(busy)}>
        {busy ? <Spinner /> : null}
        {busy ? "Refreshing…" : "Refresh from Data Hub"}
      </button>
      <OutcomeLine outcome={outcome} />
    </div>
  );
}

/** Recalculate the Health Score (stores a new immutable calculation; no scoring, no refresh). */
export function RecalculateHealth() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  async function run() {
    setBusy(true);
    setOutcome(null);
    try {
      const r = await post("/api/dpos/health");
      if (r.ok) {
        setOutcome({ kind: "success", text: String(r.json.message ?? "Health recalculated.") });
        router.refresh();
      } else {
        const e = errorText(r.json, r.status);
        setOutcome({ kind: "error", text: e.text, detail: e.detail });
      }
    } catch (err) {
      setOutcome({ kind: "error", text: err instanceof Error ? err.message : "The request could not be reached." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <SpinKeyframes />
      <button type="button" onClick={run} disabled={busy} aria-busy={busy} data-testid="recalculate-health" style={buttonStyle(busy)}>
        {busy ? <Spinner /> : null}
        {busy ? "Recalculating…" : "Recalculate Health Score"}
      </button>
      <OutcomeLine outcome={outcome} />
    </div>
  );
}

/** Management marks the board reviewed: "What Changed" restarts from this moment. */
export function MarkReviewed() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  async function run() {
    setBusy(true);
    setOutcome(null);
    try {
      const r = await post("/api/dpos/board/review");
      if (r.ok) {
        setOutcome({ kind: "success", text: String(r.json.message ?? "Marked reviewed.") });
        router.refresh();
      } else {
        const e = errorText(r.json, r.status);
        setOutcome({ kind: "error", text: e.text, detail: e.detail });
      }
    } catch (err) {
      setOutcome({ kind: "error", text: err instanceof Error ? err.message : "The request could not be reached." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" onClick={run} disabled={busy} aria-busy={busy} data-testid="mark-reviewed" style={buttonStyle(busy)}>
        {busy ? <Spinner /> : null}
        {busy ? "Saving…" : "Mark board reviewed"}
      </button>
      <OutcomeLine outcome={outcome} />
    </div>
  );
}

export interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "date" | "select" | "checkbox";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  defaultValue?: string;
  help?: string;
}

const inputStyle: CSSProperties = { width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 9px", background: "#fff", color: "var(--text)" };

/** One governed workflow operation behind a collapsible form, with in-place pending state and the exact outcome. */
export function ActionForm(props: { candidateId: string; action: string; title: string; submitLabel: string; busyLabel: string; fields: FieldSpec[]; intro?: ReactNode; defaultOpen?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { action: props.action };
    for (const f of props.fields) {
      if (f.type === "checkbox") body[f.name] = data.get(f.name) === "on";
      else {
        const v = data.get(f.name);
        if (typeof v === "string" && v.trim() !== "") body[f.name] = v;
      }
    }
    setBusy(true);
    setOutcome(null);
    try {
      const r = await post(`/api/dpos/candidates/${props.candidateId}/actions`, body);
      if (r.ok) {
        setOutcome({ kind: "success", text: String(r.json.message ?? `${props.title}: done.`) });
        router.refresh();
      } else {
        const er = errorText(r.json, r.status);
        setOutcome({ kind: "error", text: er.text, detail: er.detail });
      }
    } catch (err) {
      setOutcome({ kind: "error", text: err instanceof Error ? err.message : "The request could not be reached." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <details open={props.defaultOpen} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>{props.title}</summary>
      <SpinKeyframes />
      <form onSubmit={submit} style={{ marginTop: 10, display: "grid", gap: 10 }} data-testid={`form-${props.action}`}>
        {props.intro ? <div style={{ color: "var(--muted)", fontSize: 13 }}>{props.intro}</div> : null}
        {props.fields.map((f) => (
          <label key={f.name} style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span style={{ fontWeight: 500 }}>
              {f.label}
              {f.required ? " *" : ""}
            </span>
            {f.type === "textarea" ? (
              <textarea name={f.name} required={f.required} rows={3} placeholder={f.placeholder} defaultValue={f.defaultValue} style={inputStyle} />
            ) : f.type === "select" ? (
              <select name={f.name} required={f.required} defaultValue={f.defaultValue} style={inputStyle}>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "checkbox" ? (
              <input type="checkbox" name={f.name} defaultChecked={f.defaultValue === "on"} />
            ) : (
              <input name={f.name} type={f.type ?? "text"} required={f.required} placeholder={f.placeholder} defaultValue={f.defaultValue} step={f.type === "number" ? "any" : undefined} style={inputStyle} />
            )}
            {f.help ? <span style={{ color: "var(--muted)" }}>{f.help}</span> : null}
          </label>
        ))}
        <div>
          <button type="submit" disabled={busy} aria-busy={busy} style={buttonStyle(busy)}>
            {busy ? <Spinner /> : null}
            {busy ? props.busyLabel : props.submitLabel}
          </button>
        </div>
        <OutcomeLine outcome={outcome} />
      </form>
    </details>
  );
}
