/**
 * Company carrying-cost rate configuration tests.
 * Run: npm run test:carrying-cost-rate
 */
import { prisma } from "../src/lib/db";
import {
  CARRYING_COST_RATE_SOURCES,
  MISSING_CARRYING_RATE_COI_MESSAGE,
  setCompanyCarryingCostRate,
  getCompanyCarryingCostRate,
  listCarryingCostRateHistory,
  validateCarryingCostRateDecimal,
  isAuthorizedToEditCarryingCostRate,
} from "../src/lib/iam/company/carrying-cost-rate";
import { formatCoiBoardDisplay } from "../src/lib/iam/coi";

type Result = { id: string; name: string; pass: boolean; detail: string };

function assert(id: string, name: string, pass: boolean, detail: string): Result {
  return { id, name, pass, detail };
}

async function main() {
  const results: Result[] = [];

  results.push(
    assert(
      "CCR-AUTH",
      "Authorized roles can edit",
      isAuthorizedToEditCarryingCostRate("executive") &&
        isAuthorizedToEditCarryingCostRate("operations") &&
        !isAuthorizedToEditCarryingCostRate("owner"),
      "exec/ops vs owner"
    )
  );

  results.push(
    assert(
      "CCR-VALIDATE",
      "Reject below 0% and above max",
      !validateCarryingCostRateDecimal(-0.01).ok &&
        !validateCarryingCostRateDecimal(1.01).ok &&
        validateCarryingCostRateDecimal(0.24).ok,
      "bounds"
    )
  );

  results.push(
    assert(
      "CCR-MSG",
      "Specific missing-rate Board message",
      formatCoiBoardDisplay({
        costOfInaction: null,
        companyCarryingCostRateConfigured: false,
      }) === MISSING_CARRYING_RATE_COI_MESSAGE,
      MISSING_CARRYING_RATE_COI_MESSAGE
    )
  );

  const company = await prisma.company.create({
    data: { name: `CCR Test ${Date.now()}` },
  });

  try {
    let denied = false;
    try {
      await setCompanyCarryingCostRate({
        companyId: company.id,
        annualCarryingCostRate: 0.24,
        source: "Management-approved assumption",
        performedBy: "owner",
      });
    } catch {
      denied = true;
    }
    results.push(assert("CCR-DENY-OWNER", "Owner cannot update rate", denied, `denied=${denied}`));

    const saved = await setCompanyCarryingCostRate({
      companyId: company.id,
      annualCarryingCostRate: 0.24,
      source: "Management-approved assumption",
      configurationNote: "Interim pilot assumption",
      performedBy: "executive",
    });
    results.push(
      assert(
        "CCR-SAVE",
        "Save 24% as decimal 0.24",
        saved.annualCarryingCostRate === 0.24 && saved.displayPercent === 24 && saved.source === "Management-approved assumption",
        JSON.stringify(saved)
      )
    );

    const hist = await listCarryingCostRateHistory(company.id);
    results.push(
      assert("CCR-AUDIT", "Audit history written", hist.length >= 1 && hist[0].detail?.includes("24%"), hist[0]?.detail ?? "")
    );

    const loaded = await getCompanyCarryingCostRate(company.id);
    results.push(
      assert(
        "CCR-LOAD",
        "Load includes last updated metadata",
        loaded.lastUpdatedBy === "executive" && loaded.lastUpdatedAt != null && loaded.effectiveDate != null,
        JSON.stringify(loaded)
      )
    );

    results.push(
      assert(
        "CCR-SOURCES",
        "All approved sources listed",
        CARRYING_COST_RATE_SOURCES.length === 4,
        CARRYING_COST_RATE_SOURCES.join("|")
      )
    );
  } finally {
    await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
  }

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} — ${r.name}: ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
