/** Stage 4D board presentation primitives (server components; no client state). */
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export const NAVY = "#0b2a5b";

export const linkButtonStyle: CSSProperties = {
  background: NAVY,
  color: "#ffffff",
  border: "1px solid #08204a",
  borderRadius: 8,
  padding: "8px 14px",
  fontWeight: 600,
  fontSize: 13,
  display: "inline-block",
  whiteSpace: "nowrap",
  textDecoration: "none",
};

export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} style={linkButtonStyle}>
      {children}
    </Link>
  );
}

export function Section({ id, title, subtitle, actions, children }: { id: string; title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} data-testid={`section-${id}`} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <h2 style={{ fontSize: 18, margin: 0 }}>{title}</h2>
          {subtitle ? <p style={{ color: "var(--muted)", fontSize: 13, margin: "4px 0 0" }}>{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

const TONES: Record<string, { bg: string; fg: string }> = {
  good: { bg: "var(--ryg-green-bg)", fg: "var(--good)" },
  warn: { bg: "var(--ryg-yellow-bg)", fg: "var(--warn)" },
  bad: { bg: "var(--ryg-red-bg)", fg: "var(--bad)" },
  neutral: { bg: "var(--ryg-gray-bg)", fg: "var(--text)" },
  info: { bg: "var(--accent-soft)", fg: "var(--accent)" },
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  const t = TONES[tone]!;
  return <span style={{ background: t.bg, color: t.fg, borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{children}</span>;
}

export function Crumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }} data-testid="breadcrumbs">
      {items.map((c, i) => (
        <span key={i}>
          {i > 0 ? " / " : ""}
          {c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export const th: CSSProperties = { textAlign: "left", fontSize: 12, color: "var(--muted)", fontWeight: 600, padding: "6px 8px", borderBottom: "1px solid var(--border)", verticalAlign: "bottom" };
export const td: CSSProperties = { padding: "8px", borderBottom: "1px solid var(--border)", fontSize: 13, verticalAlign: "top" };

export const money = (n: number | null | undefined, unit: string | null = "USD"): string => {
  if (n === null || n === undefined) return "n/a";
  const u = (unit ?? "").toLowerCase();
  if (!unit || u === "usd" || u === "$") return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return `${n.toLocaleString("en-US")} ${unit}`;
};
export const pct = (n: number | null | undefined): string => (n === null || n === undefined ? "Not yet measured" : `${n}%`);
/**
 * Instants are always shown in the COMPANY time zone (never the server's or the browser's, and never a silent UTC). With no valid
 * company time zone the time is shown in UTC and labelled as such.
 */
export function when(iso: string | null | undefined, timeZone: string | null = null): string {
  if (!iso) return "n/a";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "n/a";
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
    } catch {
      /* invalid zone: fall through to the labelled UTC form */
    }
  }
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC (company time zone not available)`;
}
/** The company-local calendar day of an instant. */
export function localDay(iso: string | null | undefined, timeZone: string | null = null): string {
  if (!iso) return "n/a";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "n/a";
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    } catch {
      /* fall through */
    }
  }
  return `${date.toISOString().slice(0, 10)} UTC`;
}
/** A stored date-only value (YYYY-MM-DD, no clock time): shown as is. Never shifted by a time zone. */
export const day = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : "n/a");

export function Empty({ children }: { children: ReactNode }) {
  return <p style={{ color: "var(--muted)", margin: 0 }}>{children}</p>;
}

export function Pending({ pending }: { pending: { pending: boolean } }) {
  return pending.pending ? <Badge tone="info">Pending Next Scoring Run</Badge> : null;
}

export function DL({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl style={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: "6px 14px", margin: 0, fontSize: 14 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt style={{ color: "var(--muted)" }}>{k}</dt>
          <dd style={{ margin: 0 }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
