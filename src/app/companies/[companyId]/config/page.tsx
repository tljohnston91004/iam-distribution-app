import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { CompanyCarryingCostConfigForm } from "@/components/CompanyCarryingCostConfigForm";

export const dynamic = "force-dynamic";

export default async function CompanyConfigPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ returnTo?: string; viewAs?: string }>;
}) {
  const { companyId } = await params;
  const { returnTo, viewAs } = await searchParams;
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) notFound();

  const performedBy =
    viewAs === "operations" || viewAs === "executive" ? viewAs : "executive";

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "32px 24px" }}>
      <Link href={returnTo || "/"} style={{ fontSize: 13, color: "var(--muted)" }}>
        ← Back
      </Link>
      <header style={{ marginTop: 12, marginBottom: 20 }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", textTransform: "uppercase" }}>
          Company configuration
        </p>
        <h1 style={{ fontSize: 26, margin: "4px 0" }}>{company.name}</h1>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
          Financial and COI inputs for this company. Rates are not shared across companies.
        </p>
      </header>
      <CompanyCarryingCostConfigForm
        companyId={company.id}
        returnHref={returnTo}
        performedByDefault={performedBy}
      />
    </main>
  );
}
