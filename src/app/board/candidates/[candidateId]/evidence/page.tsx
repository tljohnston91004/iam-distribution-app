import { notFound } from "next/navigation";
import { Crumbs, Empty, LinkButton, Section, td, th } from "@/components/board/ui";
import { boardSession, loadPlan } from "@/lib/dpos/board/server";

export const dynamic = "force-dynamic";

export default async function EvidencePage({ params }: { params: Promise<{ candidateId: string }> }) {
  const s = await boardSession();
  if (!s.ok) return s.element;
  const { candidateId } = await params;
  const p = await loadPlan(s.session, candidateId);
  if (!p) notFound();
  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "28px 24px 60px" }} data-testid="evidence-page">
      <Crumbs items={[{ label: "Decision Board", href: "/board" }, { label: p.title, href: p.links.detail }, { label: "Recommended Action Plan", href: p.links.plan }, { label: "Evidence" }]} />
      <h1 style={{ fontSize: 24, margin: "4px 0 12px" }}>Evidence: {p.title}</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <LinkButton href={p.links.plan}>Back to the plan</LinkButton>
        <LinkButton href={p.links.detail}>Management detail</LinkButton>
        <LinkButton href="/board">Decision Board</LinkButton>
      </div>
      <Section id="evidence-list" title="Evidence items" subtitle="Part and variant identity are shown separately: Stck# (parent SKU) and Class (child part or variant) are never merged.">
        {p.evidence.length === 0 ? (
          <Empty>No evidence is recorded for this candidate.</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Reference", "Kind", "SKU", "Vendor", "Category", "PO", "Backorder"].map((c) => (
                  <th key={c} style={th}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.evidence.map((e) => (
                <tr key={e.evidenceRef}>
                  <td style={td}>{e.evidenceRef}</td>
                  <td style={td}>{e.kind}</td>
                  <td style={td}>{e.sku ?? "-"}</td>
                  <td style={td}>{e.vendor ?? "-"}</td>
                  <td style={td}>{e.category ?? "-"}</td>
                  <td style={td}>{e.poRef ?? "-"}</td>
                  <td style={td}>{e.backorderRef ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </main>
  );
}
