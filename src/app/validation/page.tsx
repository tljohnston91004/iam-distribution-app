import Link from "next/link";
import { ValidationPanel } from "@/components/ValidationPanel";
import { runFullValidation } from "@/lib/iam/validation/run-all";
import type { AcceptanceItem, ValidationReport } from "@/lib/iam/validation/types";

export const dynamic = "force-dynamic";

export default async function ValidationPage() {
  let report: ValidationReport;
  let checklist: AcceptanceItem[];
  let validationRunId: string | null = null;
  let loadError: string | null = null;

  try {
    const result = await runFullValidation({ integration: false });
    report = result.report;
    checklist = result.checklist;
    validationRunId = result.validationRunId;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    report = {
      ranAt: new Date().toISOString(),
      summary: { pass: 0, fail: 0, skip: 0, total: 0 },
      cases: [],
      readinessLevel: "Level 3 - Functional Test Ready",
      uatWorkbookPresent: false,
    };
    checklist = [];
  }

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
      <Link href="/" style={{ fontSize: 13, color: "var(--muted)" }}>
        ← Dashboard
      </Link>

      <header style={{ marginTop: 8 }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
          Stage 4 — Testing & Acceptance
        </p>
        <h1 style={{ fontSize: 26, margin: "4px 0" }}>IAM Validation & UAT</h1>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: 14, maxWidth: 680 }}>
          Automated checks against doc 07 sample scenarios and doc 08 acceptance checklist. The UAT workbook
          (`docs/workbooks/IAM_UAT_Validation_Test_Workbook_v1_1.xlsx`) is the formal manual pass/fail control.
        </p>
      </header>

      {loadError && (
        <p style={{ marginTop: 16, color: "var(--bad)", fontSize: 13 }}>
          Initial load hit a problem ({loadError}). Use the buttons below to re-run validation.
        </p>
      )}

      <ValidationPanel
        initialReport={report}
        initialChecklist={checklist}
        validationRunId={validationRunId}
      />
    </main>
  );
}
