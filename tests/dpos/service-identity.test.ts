import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DposError } from "../../src/lib/dpos/errors";
import {
  ALL_IAM_SERVICE_CAPABILITIES,
  DposIdentityPlatformProvider,
  IAM_SERVICE_CAPABILITIES,
  USER_ROLES,
  WorkshopServiceIdentityProvider,
  issueServiceIdentity,
  listServiceIdentities,
  looksLikeServicePrincipal,
  outboundIdentityHeaders,
  requireServiceIdentity,
  revokeServiceIdentity,
  userRoleHasServiceCapability,
} from "../../src/lib/dpos/service-identity";
import { createTestDb, makeConfig, uuid, type TestDb } from "./helpers";

async function code(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof DposError) return e.code;
    throw e;
  }
  return "NO_ERROR";
}

describe("IAM service identity", () => {
  let t: TestDb;
  const config = makeConfig();
  const W = IAM_SERVICE_CAPABILITIES.RESULTS_RETURN_WRITE;
  const R = IAM_SERVICE_CAPABILITIES.RESULTS_RETURN_READ;
  const G = IAM_SERVICE_CAPABILITIES.GOVERNED_INPUT_READ;
  before(async () => {
    t = await createTestDb();
  });
  after(async () => t.close());

  it("uses exactly the two Stage 3 Data Hub keys plus the dedicated 4A-D2 governed-read key (no generic read keys)", () => {
    assert.equal(W, "datahub.iam_results_return.write");
    assert.equal(R, "datahub.iam_results_return.read");
    assert.equal(G, "datahub.iam_governed_input.read");
    assert.deepEqual([...ALL_IAM_SERVICE_CAPABILITIES].sort(), [G, R, W].sort());
    for (const generic of ["datahub.source.read", "datahub.canonical.read", "datahub.lineage.read"]) {
      assert.equal((ALL_IAM_SERVICE_CAPABILITIES as readonly string[]).includes(generic), false, `${generic} is never an IAM service capability`);
    }
  });

  it("the user roles never hold the service capabilities", () => {
    for (const role of USER_ROLES) for (const cap of ALL_IAM_SERVICE_CAPABILITIES) assert.equal(userRoleHasServiceCapability(role, cap), false, `${role} must not hold ${cap}`);
    assert.deepEqual([...USER_ROLES], ["OWNER", "ADMINISTRATOR", "MANAGER", "OPERATOR", "VIEW_ONLY"]);
  });

  it("issues a company/installation/environment-scoped, auditable service principal with no human name or secret", async () => {
    const rec = await issueServiceIdentity(t.prisma, config, new WorkshopServiceIdentityProvider(), { actor: "operator-1", issuanceKind: "WORKSHOP" });
    assert.match(rec.identityId, /^iam-svc-[0-9a-f-]{36}$/);
    assert.equal(rec.principalKind, "SERVICE");
    assert.equal(rec.moduleId, "IAM");
    assert.equal(rec.dposCompanyId, config.dposCompanyId);
    assert.equal(rec.installationId, config.installationId);
    assert.equal(rec.environmentClass, "TEST");
    assert.deepEqual([...rec.capabilities].sort(), [G, R, W].sort());
    assert.equal(rec.status, "ACTIVE");
    assert.equal(rec.credentialRef, "IAM_DATA_HUB_CREDENTIAL", "stores the NAME of the credential variable, never a value");
    const audit = await t.prisma.dposAuditEvent.findFirst({ where: { category: "SERVICE_IDENTITY", action: "ISSUED", subjectId: rec.identityId } });
    assert.equal(audit?.actor, "operator-1");
    // valid for every capability it was issued with
    assert.equal((await requireServiceIdentity(t.prisma, config, rec.identityId, G)).identityId, rec.identityId);
    assert.equal((await requireServiceIdentity(t.prisma, config, rec.identityId, W)).identityId, rec.identityId);
    assert.equal((await requireServiceIdentity(t.prisma, config, rec.identityId, R)).identityId, rec.identityId);
    assert.deepEqual((await listServiceIdentities(t.prisma, config.dposCompanyId)).map((i) => i.identityId), [rec.identityId]);
  });

  it("rejects a user (non-service) principal and an absent identity", async () => {
    assert.equal(await code(() => requireServiceIdentity(t.prisma, config, "user-123", W)), "SERVICE_PRINCIPAL_REQUIRED");
    assert.equal(await code(() => requireServiceIdentity(t.prisma, config, "owner@acme.example", W)), "SERVICE_PRINCIPAL_REQUIRED");
    assert.equal(await code(() => requireServiceIdentity(t.prisma, config, null, W)), "SERVICE_IDENTITY_NOT_CONFIGURED");
    assert.equal(await code(() => requireServiceIdentity(t.prisma, config, `iam-svc-${uuid()}`, W)), "SERVICE_IDENTITY_NOT_FOUND");
    assert.equal(looksLikeServicePrincipal("iam-svc-x"), true);
    assert.equal(looksLikeServicePrincipal("user-1"), false);
  });

  it("rejects the identity when used for the wrong company, installation or environment", async () => {
    const [rec] = await listServiceIdentities(t.prisma, config.dposCompanyId);
    const otherCompany = uuid();
    assert.equal(
      await code(() => requireServiceIdentity(t.prisma, makeConfig({ IAM_DPOS_COMPANY_ID: otherCompany, IAM_DATA_HUB_COMPANY_ID: otherCompany }), rec!.identityId, W)),
      "SERVICE_IDENTITY_WRONG_COMPANY",
    );
    assert.equal(await code(() => requireServiceIdentity(t.prisma, makeConfig({ IAM_INSTALLATION_ID: "another-installation" }), rec!.identityId, W)), "SERVICE_IDENTITY_WRONG_INSTALLATION");
    assert.equal(await code(() => requireServiceIdentity(t.prisma, makeConfig({ IAM_ENVIRONMENT_CLASS: "WORKSHOP" }), rec!.identityId, W)), "SERVICE_IDENTITY_WRONG_ENVIRONMENT");
  });

  it("refuses capabilities outside the IAM keys (generic Data Hub keys included), and an unspecified subset limits what is held", async () => {
    for (const generic of ["datahub.canonical.read", "datahub.source.read", "datahub.lineage.read"]) {
      assert.equal(
        await code(() => issueServiceIdentity(t.prisma, config, new WorkshopServiceIdentityProvider(), { actor: "op", issuanceKind: "WORKSHOP", capabilities: [generic] })),
        "SERVICE_CAPABILITY_NOT_ALLOWED",
        generic,
      );
    }
    const resultsOnly = await issueServiceIdentity(t.prisma, config, new WorkshopServiceIdentityProvider(), { actor: "op", issuanceKind: "WORKSHOP", capabilities: [W, R] });
    assert.equal(await code(() => requireServiceIdentity(t.prisma, config, resultsOnly.identityId, G)), "SERVICE_CAPABILITY_MISSING", "no governed-read without the dedicated capability");
    const readOnly = await issueServiceIdentity(t.prisma, config, new WorkshopServiceIdentityProvider(), { actor: "op", issuanceKind: "WORKSHOP", capabilities: [R] });
    assert.equal(await code(() => requireServiceIdentity(t.prisma, config, readOnly.identityId, W)), "SERVICE_CAPABILITY_MISSING");
    assert.equal((await requireServiceIdentity(t.prisma, config, readOnly.identityId, R)).identityId, readOnly.identityId);
  });

  it("revocation takes effect immediately, is audited with a reason, and expired identities are refused", async () => {
    const rec = await issueServiceIdentity(t.prisma, config, new WorkshopServiceIdentityProvider(), { actor: "op", issuanceKind: "WORKSHOP" });
    await requireServiceIdentity(t.prisma, config, rec.identityId, W);
    assert.equal(await code(() => revokeServiceIdentity(t.prisma, rec.identityId, { actor: "op", reason: "  " })), "REASON_REQUIRED");
    const revoked = await revokeServiceIdentity(t.prisma, rec.identityId, { actor: "op-2", reason: "credential rotated" });
    assert.equal(revoked.status, "REVOKED");
    assert.equal(await code(() => requireServiceIdentity(t.prisma, config, rec.identityId, W)), "SERVICE_IDENTITY_REVOKED");
    const audit = await t.prisma.dposAuditEvent.findFirst({ where: { category: "SERVICE_IDENTITY", action: "REVOKED", subjectId: rec.identityId } });
    assert.equal(audit?.actor, "op-2");

    const expiring = await issueServiceIdentity(t.prisma, config, new WorkshopServiceIdentityProvider(), { actor: "op", issuanceKind: "WORKSHOP", expiresAt: new Date("2026-01-01T00:00:00Z"), now: new Date("2025-12-01T00:00:00Z") });
    assert.equal(await code(() => requireServiceIdentity(t.prisma, config, expiring.identityId, W, new Date("2026-02-01T00:00:00Z"))), "SERVICE_IDENTITY_EXPIRED");
    await requireServiceIdentity(t.prisma, config, expiring.identityId, W, new Date("2025-12-15T00:00:00Z"));
  });

  it("denials are audited", async () => {
    const denied = await t.prisma.dposAuditEvent.count({ where: { category: "SERVICE_IDENTITY", action: "AUTHORIZE", outcome: "DENIED" } });
    assert.ok(denied >= 5);
  });

  it("a workshop identity can never be issued in PRODUCTION; the production provider reports the issuance gap explicitly", async () => {
    const prod = makeConfig({ IAM_ENVIRONMENT_CLASS: "PRODUCTION" });
    assert.equal(await code(() => issueServiceIdentity(t.prisma, prod, new WorkshopServiceIdentityProvider(), { actor: "op", issuanceKind: "WORKSHOP" })), "WORKSHOP_IDENTITY_NOT_ALLOWED_IN_PRODUCTION");
    assert.equal(await code(() => issueServiceIdentity(t.prisma, prod, new DposIdentityPlatformProvider(), { actor: "op", issuanceKind: "PRODUCTION" })), "IDENTITY_PLATFORM_NOT_AVAILABLE");
    assert.equal(await code(() => issueServiceIdentity(t.prisma, config, new WorkshopServiceIdentityProvider(), { actor: "op", issuanceKind: "PRODUCTION" })), "SERVICE_IDENTITY_PROVIDER_MISMATCH");
    assert.equal(await code(() => issueServiceIdentity(t.prisma, config, new WorkshopServiceIdentityProvider(), { actor: " ", issuanceKind: "WORKSHOP" })), "ACTOR_REQUIRED");
  });

  it("outbound headers carry the service identity and company; the bearer comes only from the named environment variable", () => {
    const h = outboundIdentityHeaders({ identityId: "iam-svc-1", credentialRef: "MY_SECRET_VAR" }, config.dposCompanyId, "corr-1", { MY_SECRET_VAR: "s3cr3t" });
    assert.equal(h["x-identity-id"], "iam-svc-1");
    assert.equal(h["x-user-id"], "iam-svc-1");
    assert.equal(h["x-company-id"], config.dposCompanyId);
    assert.equal(h.authorization, "Bearer s3cr3t");
    const none = outboundIdentityHeaders({ identityId: "iam-svc-1", credentialRef: "MY_SECRET_VAR" }, config.dposCompanyId, "corr-1", {});
    assert.equal(none.authorization, undefined);
  });
});
