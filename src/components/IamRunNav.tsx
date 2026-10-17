import Link from "next/link";

export function IamRunNav({
  runId,
  companyId,
  active,
}: {
  runId: string;
  companyId?: string;
  active: "dashboard" | "assigned" | "archive";
}) {
  const link = (key: typeof active | "config", href: string, label: string) => (
    <Link
      href={href}
      style={{
        padding: "8px 14px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: active === key ? 600 : 400,
        background: active === key ? "var(--accent-soft)" : "transparent",
        border: active === key ? "1px solid var(--accent)" : "1px solid transparent",
        color: active === key ? "var(--accent)" : "var(--muted)",
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );

  return (
    <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16, marginBottom: 4 }}>
      {link("dashboard", `/runs/${runId}`, "Decision Board")}
      {link("assigned", `/runs/${runId}/assigned`, "My Assigned")}
      {link("archive", `/runs/${runId}/archive`, "Archive / History")}
      {companyId
        ? link(
            "config",
            `/companies/${companyId}/config?returnTo=${encodeURIComponent(`/runs/${runId}`)}#carrying-cost-rate`,
            "Company config"
          )
        : null}
    </nav>
  );
}
