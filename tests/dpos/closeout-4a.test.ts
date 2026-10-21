/**
 * Stage 4A closeout (Product Owner decisions 4A-D1, 4A-D3 .. 4A-D6).
 *
 *  - Configuration alignment: unset mode => standalone; explicit integrated mode is validated and fails closed; an
 *    explicitly integrated deployment is never silently downgraded to standalone.
 *  - Service identity: governed issuance only; workshop identities stay separate from production.
 *  - Legacy V1.5 protection: legacy data stays readable and untouched; nothing creates canonical candidates from it.
 *  - Input persistence boundary: IAM keeps references and metadata, never a shadow copy of the governed Data Hub inputs.
 *  - No developer-machine layout (and no junction) is encoded in product code, configuration or release metadata.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { DposConfigError, loadDposIntegrationConfig, requireIntegratedConfig } from "../../src/lib/dpos/config";
import { DposError } from "../../src/lib/dpos/errors";
import { type InputStatusResponse } from "../../src/lib/dpos/data-hub-client";
import { legacyFingerprint, combineFingerprint, legacyTableNames, stage4aTableNames } from "../../src/lib/dpos/migrate/governed-migrate";
import { runRefresh } from "../../src/lib/dpos/refresh";
import { schedulerTick } from "../../src/lib/dpos/scheduler";
import {
  DposIdentityPlatformProvider,
  IAM_SERVICE_CAPABILITIES,
  WorkshopServiceIdentityProvider,
  issueServiceIdentity,
  requireServiceIdentity,
} from "../../src/lib/dpos/service-identity";
import { boundContext, createTestDb, envFor, makeConfig, REPO_ROOT, uuid, type TestDb } from "./helpers";

const code = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return "NO_ERROR";
  } catch (e) {
    return (e as { code?: string }).code ?? `UNCODED:${(e as Error).message}`;
  }
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("4A-D4 configuration alignment", () => {
  it("IAM_DEPLOYMENT_MODE unset, blank or whitespace => standalone (V1.5 behaviour), never integrated", () => {
    for (const v of [undefined, "", "   "]) {
      const r = loadDposIntegrationConfig({ IAM_DEPLOYMENT_MODE: v });
      assert.ok(r.ok && r.config.mode === "STANDALONE_LEGACY", `value ${JSON.stringify(v)}`);
    }
    // integrated settings present but the mode unset must NOT turn an existing standalone install into an integrated one
    const withIntegrationVars = loadDposIntegrationConfig(envFor({ IAM_DEPLOYMENT_MODE: undefined }));
    assert.ok(withIntegrationVars.ok && withIntegrationVars.config.mode === "STANDALONE_LEGACY");
    assert.throws(() => requireIntegratedConfig({ IAM_DEPLOYMENT_MODE: undefined }), DposConfigError);
  });

  it("explicit integrated mode with valid company, Data Hub endpoint and environment loads as integrated", () => {
    const r = loadDposIntegrationConfig(envFor());
    assert.ok(r.ok && r.config.mode === "DPOS_INTEGRATED");
  });

  it("explicit integrated mode fails closed when any required integration setting is missing — it is never downgraded", () => {
    for (const key of ["IAM_ENVIRONMENT_CLASS", "IAM_CONFIGURATION_ID", "IAM_DPOS_COMPANY_ID", "IAM_DATA_HUB_COMPANY_ID", "IAM_INSTALLATION_ID", "DATA_HUB_BASE_URL"]) {
      const r = loadDposIntegrationConfig(envFor({ [key]: undefined }));
      assert.equal(r.ok, false, `${key} missing must fail`);
      assert.ok(!r.ok && r.issues.some((i) => i.field === key && i.code === "CONFIG_MISSING"), `${key} reported as CONFIG_MISSING`);
      assert.throws(() => requireIntegratedConfig(envFor({ [key]: undefined })), DposConfigError, key);
    }
  });

  it("explicit integrated mode rejects inconsistent or malformed settings (company mismatch, non-origin URL, credentials in URL)", () => {
    assert.equal(loadDposIntegrationConfig(envFor({ IAM_DATA_HUB_COMPANY_ID: uuid() })).ok, false);
    assert.equal(loadDposIntegrationConfig(envFor({ IAM_DPOS_COMPANY_ID: "not-a-uuid", IAM_DATA_HUB_COMPANY_ID: "not-a-uuid" })).ok, false);
    assert.equal(loadDposIntegrationConfig(envFor({ DATA_HUB_BASE_URL: "http://hub.example/api/v1" })).ok, false);
    assert.equal(loadDposIntegrationConfig(envFor({ DATA_HUB_BASE_URL: "http://user:pw@hub.example" })).ok, false);
    assert.equal(loadDposIntegrationConfig(envFor({ IAM_ENVIRONMENT_CLASS: "STAGING" })).ok, false);
  });

  it("a misspelled or differently-cased mode value is an error, not a silent standalone", () => {
    for (const v of ["DPOS_INTEGRATD", "dpos_integrated", "integrated", "DPOS-INTEGRATED", "true", "1"]) {
      const r = loadDposIntegrationConfig(envFor({ IAM_DEPLOYMENT_MODE: v }));
      assert.equal(r.ok, false, v);
      assert.ok(!r.ok && r.issues[0]!.code === "CONFIG_INVALID_MODE", v);
    }
  });

  it("a production environment forbids the workshop registry override", () => {
    const r = loadDposIntegrationConfig(envFor({ IAM_ENVIRONMENT_CLASS: "PRODUCTION", IAM_DPOS_REGISTRY_FILE: "x.json" }));
    assert.ok(!r.ok && r.issues.some((i) => i.code === "CONFIG_FORBIDDEN_IN_PRODUCTION"));
  });
});

describe("4A-D1 service identity: governed issuance, never hand-edited, workshop separate from production", () => {
  let t: TestDb;
  before(async () => {
    t = await createTestDb();
  });
  after(async () => t.close());

  it("an integrated deployment with no issued service identity fails closed for every service operation", async () => {
    const config = makeConfig();
    assert.equal(await code(() => requireServiceIdentity(t.prisma, config, null, IAM_SERVICE_CAPABILITIES.GOVERNED_INPUT_READ)), "SERVICE_IDENTITY_NOT_CONFIGURED");
    // a hand-typed identity id that was never issued through the governed process is refused
    for (const cap of Object.values(IAM_SERVICE_CAPABILITIES)) {
      assert.equal(await code(() => requireServiceIdentity(t.prisma, config, `iam-svc-${uuid()}`, cap)), "SERVICE_IDENTITY_NOT_FOUND", cap);
    }
  });

  it("the production provider is the governed seam (and reports the gap) — a production identity cannot be fabricated locally", async () => {
    const prod = makeConfig({ IAM_ENVIRONMENT_CLASS: "PRODUCTION" });
    assert.equal(
      await code(() => issueServiceIdentity(t.prisma, prod, new WorkshopServiceIdentityProvider(), { actor: "op", issuanceKind: "WORKSHOP" })),
      "WORKSHOP_IDENTITY_NOT_ALLOWED_IN_PRODUCTION",
    );
    assert.equal(
      await code(() => issueServiceIdentity(t.prisma, prod, new WorkshopServiceIdentityProvider(), { actor: "op", issuanceKind: "PRODUCTION" })),
      "SERVICE_IDENTITY_PROVIDER_MISMATCH",
    );
    assert.equal(
      await code(() => issueServiceIdentity(t.prisma, prod, new DposIdentityPlatformProvider(), { actor: "op", issuanceKind: "PRODUCTION" })),
      "IDENTITY_PLATFORM_NOT_AVAILABLE",
    );
    assert.equal(await code(() => issueServiceIdentity(t.prisma, prod, new DposIdentityPlatformProvider(), { actor: "", issuanceKind: "PRODUCTION" })), "ACTOR_REQUIRED", "issuance is always attributed to an operator");
  });

  it("a workshop/test identity cannot be used by a production configuration", async () => {
    const workshop = await issueServiceIdentity(t.prisma, makeConfig({ IAM_ENVIRONMENT_CLASS: "TEST" }), new WorkshopServiceIdentityProvider(), { actor: "op", issuanceKind: "WORKSHOP" });
    const prod = makeConfig({ IAM_ENVIRONMENT_CLASS: "PRODUCTION" });
    assert.equal(await code(() => requireServiceIdentity(t.prisma, prod, workshop.identityId, IAM_SERVICE_CAPABILITIES.GOVERNED_INPUT_READ)), "SERVICE_IDENTITY_WRONG_ENVIRONMENT");
    assert.equal(workshop.issuanceKind, "WORKSHOP");
  });

  it("the identity is not tied to a human user (service principal only, no user fields) and carries no secret", async () => {
    const config = makeConfig();
    const rec = await issueServiceIdentity(t.prisma, config, new WorkshopServiceIdentityProvider(), { actor: "operator-9", issuanceKind: "WORKSHOP" });
    assert.match(rec.identityId, /^iam-svc-/);
    assert.equal(rec.principalKind, "SERVICE");
    const row = await t.prisma.dposServiceIdentity.findUniqueOrThrow({ where: { identityId: rec.identityId } });
    assert.ok(!/@/.test(JSON.stringify(row).replace(/operator-9/g, "")), "no e-mail / user name stored on the identity");
    assert.equal(row.credentialRef, "IAM_DATA_HUB_CREDENTIAL", "a variable NAME, never a credential value");
  });
});

describe("4A-D5 legacy V1.5 data is preserved and never auto-promoted to canonical candidates", () => {
  let t: TestDb;
  const cfg = makeConfig();
  before(async () => {
    t = await createTestDb();
  });
  after(async () => t.close());

  const GOOD: InputStatusResponse = {
    companyId: "x",
    generatedAt: "2026-10-21T00:00:00.000Z",
    sources: ["OPEN_PURCHASE_ORDER_LINE", "CUSTOMER_BACKORDER_LINE"].map((f) => ({
      objectFamily: f as never,
      availability: "AVAILABLE" as never,
      latestSuccessfulRun: { importBatchId: `b-${f}`, dataSourceId: "ds", status: "SUCCEEDED", receivedAt: "2026-10-20T00:00:00.000Z", sourceRunAt: "2026-10-19T00:00:00.000Z" },
      freshness: { status: "CURRENT", referenceTimestamp: "2026-10-19T00:00:00.000Z" },
    })),
  };

  it("binding, refreshing and scheduling over a database that holds legacy review cycles creates no canonical candidate and changes no legacy row", async () => {
    // Legacy V1.5 data: a company, an old test board (review cycle) and a recommendation on it.
    const legacyCompany = await t.prisma.company.create({ data: { name: "Legacy Test Co" } });
    const legacyRun = await t.prisma.iamRun.create({
      data: { companyId: legacyCompany.id, runName: "Old test board", reviewDate: new Date("2026-05-01"), reviewWeekStart: new Date("2026-04-27"), reviewWeekEnd: new Date("2026-05-03") },
    });
    const legacyRec = await t.prisma.recommendation.create({
      data: { iamRunId: legacyRun.id, sourceModule: "RSE", opportunityKey: "legacy-opp-1", recommendationType: "Reduce excess", title: "Legacy test recommendation" },
    });

    const legacyTables = legacyTableNames(REPO_ROOT);
    const before = combineFingerprint(legacyFingerprint(t.file, legacyTables));

    // bind THIS legacy company, run refresh (manual and scheduled), and operate the outbox-free integrated services
    const ctx = await (await import("../../src/lib/dpos/company-context")).bindCompany(t.prisma, cfg, { actor: "op", existingIamCompanyId: legacyCompany.id });
    assert.equal(ctx.iamCompanyId, legacyCompany.id);
    const client = { async getInputStatus() { return GOOD; }, async getSyncStatus() { return { refresh: { schedule: { timeZone: "America/Chicago", refreshHourLocal: 2 } } }; } };
    const r = await runRefresh({ db: t.prisma, config: cfg, context: ctx, client: client as never }, { trigger: "MANUAL_REFRESH", requestedBy: "test" });
    assert.equal(r.ok, true);
    const tick = await schedulerTick({ db: t.prisma, config: cfg, context: ctx, client: client as never, now: () => new Date("2026-10-25T07:01:00Z") });
    assert.equal(tick.action, "RAN");

    // 1. no canonical candidate (or any part of the canonical chain) exists merely because legacy data exists
    for (const table of ["iamCoreCandidate", "iamCoreSystemRecommendation", "iamCoreManagementPlan", "iamCoreOwnership", "iamCoreContributor", "iamCoreExecutionState", "iamCoreOutcome"] as const) {
      assert.equal(await (t.prisma[table] as unknown as { count(): Promise<number> }).count(), 0, `${table} must stay empty`);
    }
    assert.equal(await t.prisma.dposResultsReturnOutbox.count(), 0, "no Results Return event is produced from legacy data");

    // 2. the legacy rows are preserved byte-for-byte and remain readable
    assert.equal(combineFingerprint(legacyFingerprint(t.file, legacyTables)), before, "every V1.5 table keeps identical rows");
    assert.equal((await t.prisma.iamRun.findUniqueOrThrow({ where: { id: legacyRun.id } })).runName, "Old test board");
    assert.equal((await t.prisma.recommendation.findUniqueOrThrow({ where: { id: legacyRec.id } })).title, "Legacy test recommendation");
    assert.equal(await t.prisma.iamRun.count(), 1);
  });

  it("the new integrated tables are separate from the legacy tables (no legacy table references or is referenced by them)", () => {
    const legacy = new Set(legacyTableNames(REPO_ROOT));
    const sql = fs.readFileSync(path.join(REPO_ROOT, "prisma", "migrations", "20261021100000_stage4a_core_integration_foundation", "migration.sql"), "utf8");
    for (const table of stage4aTableNames(REPO_ROOT)) assert.ok(!legacy.has(table), `${table} is not a legacy table`);
    for (const l of legacy) {
      assert.ok(!new RegExp(`REFERENCES\\s+"${l}"`, "i").test(sql), `Stage 4A SQL must not reference legacy table ${l}`);
      assert.ok(!new RegExp(`(ALTER|DROP)\\s+TABLE\\s+"${l}"`, "i").test(sql), `Stage 4A SQL must not alter ${l}`);
    }
  });

  it("no code path reads legacy recommendations/actions to build a canonical candidate (legacy models are touched only by read-only company-scoping lookups)", () => {
    const dir = path.join(REPO_ROOT, "src", "lib", "dpos");
    const scopingFiles = new Set(["with-access.ts", "page-gate.tsx"]);
    const offenders: string[] = [];
    for (const f of walk(dir).filter((p) => /\.(ts|tsx)$/.test(p))) {
      const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      for (const m of src.matchAll(/\b(?:prisma|db)\.(recommendation\w*|action\w*|iamRun|financialImpact\w*|evidenceBatch|workflow\w*|lifecycle\w*)\.(\w+)\(/g)) {
        // permitted: a single-row read used to find which company owns the addressed legacy resource (access scoping)
        const ok = scopingFiles.has(path.basename(f)) && m[2] === "findUnique";
        if (!ok) offenders.push(`${path.relative(REPO_ROOT, f)}: ${m[0]}`);
      }
    }
    assert.deepEqual(offenders, [], "legacy data is only ever read for company scoping, never promoted or written");
  });
});

describe("4A-D6 input persistence boundary: reference + snapshot metadata, no shadow Data Hub", () => {
  it("IAM defines no table that stores Open PO / Customer Backorder lines or other governed input records", () => {
    const names = [...stage4aTableNames(REPO_ROOT), ...legacyTableNames(REPO_ROOT)].filter((n) => !n.startsWith("iam_core_") || true);
    const sql = fs.readFileSync(path.join(REPO_ROOT, "prisma", "migrations", "20261021100000_stage4a_core_integration_foundation", "migration.sql"), "utf8");
    for (const n of stage4aTableNames(REPO_ROOT)) {
      assert.ok(!/(purchase_order|backorder|keystroke|canonical_record|governed_input|input_record)/i.test(n), `${n} must not be a copy of governed input data`);
    }
    assert.ok(!/(purchase_order_line|backorder_line|parent_sku|child_part)/i.test(sql), "Stage 4A schema has no input-line columns");
    assert.ok(names.length > 0);
  });

  it("the Data Hub client pages governed records on demand and the refresh path never pulls or stores them", () => {
    const refresh = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "dpos", "refresh.ts"), "utf8");
    const scheduler = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "dpos", "scheduler.ts"), "utf8");
    for (const src of [refresh, scheduler]) {
      assert.ok(!/iterateInputRecords|getInputRecords|fetchInputRecords/.test(src), "refresh/scheduler do not copy record data");
    }
  });

  it("a refresh persists only per-source run references and freshness metadata (no business record values)", async () => {
    const t = await createTestDb();
    try {
      const ctx = await boundContext(t.prisma, cfgForPersistence);
      const status: InputStatusResponse = {
        companyId: "x",
        generatedAt: "2026-10-21T00:00:00.000Z",
        sources: [
          {
            objectFamily: "OPEN_PURCHASE_ORDER_LINE" as never,
            availability: "AVAILABLE" as never,
            latestSuccessfulRun: { importBatchId: "batch-1", dataSourceId: "ds", status: "SUCCEEDED", receivedAt: "2026-10-20T00:00:00.000Z", sourceRunAt: "2026-10-19T00:00:00.000Z" },
            freshness: { status: "CURRENT", referenceTimestamp: "2026-10-19T00:00:00.000Z" },
          },
        ],
      };
      const client = { async getInputStatus() { return status; }, async getSyncStatus() { return { refresh: { schedule: { timeZone: "America/Chicago", refreshHourLocal: 2 } } }; } };
      const r = await runRefresh({ db: t.prisma, config: cfgForPersistence, context: ctx, client: client as never }, { trigger: "MANUAL_REFRESH", requestedBy: "test" });
      assert.equal(r.ok, true);
      const attempt = await t.prisma.dposRefreshAttempt.findFirstOrThrow();
      const summary = JSON.parse(attempt.inputSummaryJson ?? "{}");
      const text = JSON.stringify(summary);
      assert.match(text, /batch-1/, "source run reference is kept");
      assert.ok(!/parentSku|childPartOrVariant|quantity|vendor|customer/i.test(text), "no business record values are copied");
    } finally {
      await t.close();
    }
  });
});

const cfgForPersistence = makeConfig();

describe("4A-D3 the DPOS worktree location and the temporary junction are not part of the product", () => {
  it("no source, script, configuration, test or release metadata encodes a developer machine path, the DPOS worktree name or the junction", () => {
    // Stage 4A product files only (older V1.5 docs/scripts that predate this stage are out of scope).
    const roots = [["src", "lib", "dpos"], ["src", "app", "api", "dpos"], ["tests", "dpos"], ["prisma", "migrations"], ["docs", "dpos-integration"]].map((p) => path.join(REPO_ROOT, ...p));
    const singles = ["src/instrumentation.ts", "scripts/iam-migrate.ts", "scripts/iam-dpos.ts", "scripts/run-iam-regression.ts", "scripts/sync-dpos-contract.ts", "package.json", ".env.example"].map((p) => path.join(REPO_ROOT, p));
    const files = [...roots.flatMap((r) => walk(r)), ...singles]
      .filter((f) => /\.(ts|tsx|mjs|cjs|js|json|md|prisma|sql|example)$/.test(f) || f.endsWith(".env.example"))
      .filter((f) => !f.endsWith("closeout-4a.test.ts"));
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      if (/Terry Johnston|C:\\Users\\|DPOSDH-iam-integration|DPOS-IAM[\\/]/i.test(src)) offenders.push(path.relative(REPO_ROOT, f));
    }
    assert.deepEqual(offenders, []);
  });
});
