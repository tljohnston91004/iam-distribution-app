import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { assertSameCompany, bindCompany, resolveCompanyContext, updateBinding } from "../../src/lib/dpos/company-context";
import { loadDposIntegrationConfig } from "../../src/lib/dpos/config";
import { DposError } from "../../src/lib/dpos/errors";
import { createTestDb, DEFAULT_COMPANY_ID, envFor, makeConfig, uuid, type TestDb } from "./helpers";

async function rejects(fn: () => Promise<unknown>, code: string) {
  await assert.rejects(fn, (e: unknown) => e instanceof DposError && e.code === code, `expected ${code}`);
}

describe("governed company context", () => {
  let t: TestDb;
  before(async () => {
    t = await createTestDb();
  });
  after(async () => t.close());

  it("has no silent default company: an unbound installation is rejected", async () => {
    await rejects(() => resolveCompanyContext(t.prisma, makeConfig()), "COMPANY_NOT_BOUND");
  });

  it("binds explicitly (audited) and resolves the full governed context", async () => {
    const config = makeConfig();
    const ctx = await bindCompany(t.prisma, config, { actor: "operator-1", createCompanyName: "Acme Distribution" });
    assert.equal(ctx.dposCompanyId, DEFAULT_COMPANY_ID);
    assert.equal(ctx.dataHubCompanyId, DEFAULT_COMPANY_ID);
    assert.equal(ctx.installationId, "inst-test-1");
    assert.equal(ctx.companyTimeZone, "America/Chicago");
    assert.equal(ctx.timeZoneStatus, "OK");
    assert.equal(ctx.environmentClass, "TEST");
    assert.equal(ctx.configurationId, "cfg-test-1");
    assert.ok(ctx.iamCompanyId, "maps to the V1.5 companies row");
    const company = await t.prisma.company.findUnique({ where: { id: ctx.iamCompanyId } });
    assert.equal(company?.name, "Acme Distribution");
    const audit = await t.prisma.dposAuditEvent.findMany({ where: { category: "COMPANY_CONTEXT" } });
    assert.ok(audit.length >= 1 && audit[0]!.actor === "operator-1");
    // idempotent
    const again = await bindCompany(t.prisma, config, { actor: "operator-1", createCompanyName: "Acme Distribution" });
    assert.equal(again.bindingId, ctx.bindingId);
    assert.equal(await t.prisma.company.count(), 1, "re-binding does not create a second company");
  });

  it("rejects mismatched company identities in configuration (DPOS vs Data Hub)", () => {
    const r = loadDposIntegrationConfig(envFor({ IAM_DATA_HUB_COMPANY_ID: uuid() }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.issues.some((i) => i.code === "COMPANY_ID_MISMATCH"));
  });

  it("rejects missing company configuration (no default)", () => {
    const r = loadDposIntegrationConfig(envFor({ IAM_DPOS_COMPANY_ID: undefined, IAM_DATA_HUB_COMPANY_ID: undefined, IAM_INSTALLATION_ID: undefined }));
    assert.equal(r.ok, false);
    if (!r.ok) {
      const fields = r.issues.map((i) => i.field);
      assert.ok(fields.includes("IAM_DPOS_COMPANY_ID") && fields.includes("IAM_INSTALLATION_ID"));
    }
  });

  it("rejects a second binding for another company and configuration drift against the binding", async () => {
    const otherId = uuid();
    const o = makeConfig({ IAM_DPOS_COMPANY_ID: otherId, IAM_DATA_HUB_COMPANY_ID: otherId });
    await rejects(() => resolveCompanyContext(t.prisma, o), "COMPANY_BINDING_MISMATCH");
    await rejects(() => bindCompany(t.prisma, o, { actor: "operator-2", createCompanyName: "Second" }), "COMPANY_BINDING_MISMATCH");
    // installation / environment / configuration drift on the SAME company
    await rejects(() => resolveCompanyContext(t.prisma, makeConfig({ IAM_INSTALLATION_ID: "some-other-installation" })), "COMPANY_BINDING_MISMATCH");
    await rejects(() => resolveCompanyContext(t.prisma, makeConfig({ IAM_ENVIRONMENT_CLASS: "WORKSHOP" })), "COMPANY_BINDING_MISMATCH");
    await rejects(() => resolveCompanyContext(t.prisma, makeConfig({ IAM_CONFIGURATION_ID: "cfg-other" })), "COMPANY_BINDING_MISMATCH");
  });

  it("company ids can never be changed on an existing binding; time zone can be updated explicitly", async () => {
    const tz = makeConfig({ IAM_COMPANY_TIME_ZONE: "America/New_York" });
    await rejects(() => resolveCompanyContext(t.prisma, tz), "COMPANY_BINDING_MISMATCH"); // drift until explicitly updated
    const updated = await updateBinding(t.prisma, tz, "operator-1");
    assert.equal(updated.companyTimeZone, "America/New_York");
    await resolveCompanyContext(t.prisma, tz);
  });

  it("a request that names no company or another company is rejected", async () => {
    const tz = makeConfig({ IAM_COMPANY_TIME_ZONE: "America/New_York" });
    const ctx = await resolveCompanyContext(t.prisma, tz);
    assert.throws(() => assertSameCompany(ctx, undefined, "x-company-id"), (e: unknown) => e instanceof DposError && e.code === "COMPANY_MISSING");
    assert.throws(() => assertSameCompany(ctx, "   ", "x-company-id"), (e: unknown) => e instanceof DposError && e.code === "COMPANY_MISSING");
    assert.throws(() => assertSameCompany(ctx, uuid(), "x-company-id"), (e: unknown) => e instanceof DposError && e.code === "COMPANY_MISMATCH");
    assertSameCompany(ctx, DEFAULT_COMPANY_ID, "x-company-id");
    assertSameCompany(ctx, ctx.iamCompanyId, "path");
  });

  it("a missing or invalid time zone is reported, never defaulted", async () => {
    const missing = loadDposIntegrationConfig(envFor({ IAM_COMPANY_TIME_ZONE: undefined }));
    assert.ok(missing.ok && missing.config.mode === "DPOS_INTEGRATED" && missing.config.companyTimeZone === null);
    const bad = loadDposIntegrationConfig(envFor({ IAM_COMPANY_TIME_ZONE: "Mars/Olympus" }));
    assert.ok(bad.ok && bad.config.mode === "DPOS_INTEGRATED" && bad.config.companyTimeZone === "Mars/Olympus");
  });
});

describe("deployment mode configuration", () => {
  it("defaults to STANDALONE_LEGACY (V1.5 unchanged) and rejects unknown modes", () => {
    const d = loadDposIntegrationConfig({});
    assert.ok(d.ok && d.config.mode === "STANDALONE_LEGACY");
    const bad = loadDposIntegrationConfig({ IAM_DEPLOYMENT_MODE: "SOMETHING_ELSE" });
    assert.equal(bad.ok, false);
  });
  it("requires an origin-only Data Hub URL without credentials and forbids registry override in production", () => {
    assert.equal(loadDposIntegrationConfig(envFor({ DATA_HUB_BASE_URL: "https://user:pw@hub.example.com" })).ok, false);
    assert.equal(loadDposIntegrationConfig(envFor({ DATA_HUB_BASE_URL: "https://hub.example.com/api/v1" })).ok, false);
    assert.equal(loadDposIntegrationConfig(envFor({ IAM_ENVIRONMENT_CLASS: "PRODUCTION", IAM_DPOS_REGISTRY_FILE: "x.json" })).ok, false);
  });
});
