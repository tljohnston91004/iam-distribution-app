import Link from "next/link";

export function IamRunNav({
  runId,
  active,
}: {
  runId: string;
  active: "dashboard" | "assigned" | "archive";
}) {
  const link = (key: typeof active, href: string, label: string) => (
    <Link
      href={href}
      style={{
        padding: "8px 14px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: active === key ? 600 : 400,
        background: active === key ? "var(--panel-2)" : "transparent",
        border: active === key ? "1px solid var(--border)" : "1px solid transparent",
        color: active === key ? "var(--text)" : "var(--muted)",
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );

  return (
    <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
      {link("dashboard", `/runs/${runId}`, "Management Dashboard")}
      {link("assigned", `/runs/${runId}/assigned`, "My Assigned Actions")}
      {link("archive", `/runs/${runId}/archive`, "Completed Archive")}
    </nav>
  );
}
