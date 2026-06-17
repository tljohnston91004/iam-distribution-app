/**
 * CLI validation runner — doc 07 / doc 08
 * Usage: npm run validate
 */
import { runFullValidation } from "../src/lib/iam/validation/run-all";

async function main() {
  const integration = process.argv.includes("--unit-only") ? false : true;
  console.log(`IAM validation (${integration ? "unit + integration" : "unit only"})...\n`);

  const { report, checklist, validationRunId } = await runFullValidation({ integration });

  for (const c of report.cases) {
    const icon = c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "○";
    console.log(`${icon} ${c.id} — ${c.name}: ${c.message}`);
  }

  console.log(`\nSummary: ${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.skip} skip`);
  console.log(`Readiness: ${report.readinessLevel}`);
  console.log(`UAT workbook: ${report.uatWorkbookPresent ? "present" : "MISSING (npm run docs:extract)"}`);
  if (validationRunId) console.log(`Validation run: ${validationRunId}`);

  const failedChecklist = checklist.filter((c) => c.status === "Fail - Correction Required");
  if (failedChecklist.length) {
    console.log("\nChecklist failures:");
    for (const item of failedChecklist) {
      console.log(`  ✗ [${item.category}] ${item.requirement}`);
    }
  }

  process.exit(report.summary.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
