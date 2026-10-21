/**
 * IAM <-> DPOS operator CLI (Stage 4A). Governed, audited, explicit — nothing here runs implicitly.
 *
 *   npx tsx scripts/iam-dpos.ts config-check
 *   npx tsx scripts/iam-dpos.ts bind-company --actor <operator> (--existing-iam-company-id <id> | --create-company-name <name>)
 *   npx tsx scripts/iam-dpos.ts update-binding --actor <operator>
 *   npx tsx scripts/iam-dpos.ts issue-identity --actor <operator> [--kind WORKSHOP|PRODUCTION] [--credential-ref <ref>]
 *   npx tsx scripts/iam-dpos.ts list-identities
 *   npx tsx scripts/iam-dpos.ts revoke-identity --identity-id <id> --reason <text> --actor <operator>
 *   npx tsx scripts/iam-dpos.ts fixture-run --candidate-id <uuid> [--send]   (non-production only; controlled fixture events)
 *
 * Configuration comes from the environment / .env (see .env.example). No secret is read from or written to this file.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { describeConfig, loadDposIntegrationConfig, requireIntegratedConfig } from "../src/lib/dpos/config";
import { bindCompany, resolveCompanyContext, updateBinding } from "../src/lib/dpos/company-context";
import { DataHubClient } from "../src/lib/dpos/data-hub-client";
import { assertFixturesAllowed, FIXTURE_EVENT_TYPES, fixtureEvent } from "../src/lib/dpos/fixtures";
import { enqueueResultsReturnEvent, flushOutbox } from "../src/lib/dpos/outbox";
import {
  DposIdentityPlatformProvider,
  IAM_SERVICE_CAPABILITIES,
  WorkshopServiceIdentityProvider,
  issueServiceIdentity,
  listServiceIdentities,
  requireServiceIdentity,
  revokeServiceIdentity,
} from "../src/lib/dpos/service-identity";

const REPO = path.resolve(__dirname, "..");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const need = (name: string) => {
  const v = arg(name);
  if (!v) {
    console.error(`Missing ${name}`);
    process.exit(2);
  }
  return v;
};
const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));

async function main() {
  const envFile = path.join(REPO, ".env");
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") process.loadEnvFile(envFile);
  const cmd = process.argv[2];

  if (cmd === "config-check") {
    const r = loadDposIntegrationConfig(process.env);
    if (!r.ok) {
      out({ ok: false, issues: r.issues });
      process.exit(1);
    }
    out({ ok: true, config: describeConfig(r.config) });
    return;
  }

  const config = requireIntegratedConfig(process.env);
  const actor = () => need("--actor");

  switch (cmd) {
    case "bind-company": {
      const ctx = await bindCompany(prisma, config, {
        actor: actor(),
        existingIamCompanyId: arg("--existing-iam-company-id"),
        createCompanyName: arg("--create-company-name"),
      });
      out(ctx);
      return;
    }
    case "update-binding":
      out(await updateBinding(prisma, config, actor()));
      return;
    case "issue-identity": {
      const kind = (arg("--kind") ?? "WORKSHOP") as "WORKSHOP" | "PRODUCTION";
      const provider = kind === "PRODUCTION" ? new DposIdentityPlatformProvider() : new WorkshopServiceIdentityProvider();
      const rec = await issueServiceIdentity(prisma, config, provider, { actor: actor(), issuanceKind: kind, credentialRef: arg("--credential-ref") ?? null });
      out({
        identity: rec,
        nextSteps: [
          `Set IAM_SERVICE_IDENTITY_ID=${rec.identityId} in the IAM environment.`,
          "The Data Hub operator must add this id to DATA_HUB_IAM_RESULTS_RETURN_SERVICE_IDENTITY_IDS and grant datahub.iam_results_return.write / .read through the DPOS Authorization service (operator action; not performed by IAM).",
          "The credential value is supplied only through the environment variable named by IAM_SERVICE_CREDENTIAL_ENV and is never stored here.",
        ],
      });
      return;
    }
    case "list-identities": {
      const ctx = await resolveCompanyContext(prisma, config);
      out(await listServiceIdentities(prisma, ctx.dposCompanyId));
      return;
    }
    case "revoke-identity":
      out(await revokeServiceIdentity(prisma, need("--identity-id"), { actor: actor(), reason: need("--reason") }));
      return;
    case "fixture-run": {
      assertFixturesAllowed(config);
      const ctx = await resolveCompanyContext(prisma, config);
      const candidateId = arg("--candidate-id") ?? randomUUID();
      const queued = [];
      for (const t of FIXTURE_EVENT_TYPES) queued.push((await enqueueResultsReturnEvent(prisma, ctx, fixtureEvent(t, candidateId))).row);
      let flushed: unknown = "not sent (add --send to transmit)";
      if (process.argv.includes("--send")) {
        const identity = await requireServiceIdentity(prisma, config, config.serviceIdentity.identityId, IAM_SERVICE_CAPABILITIES.RESULTS_RETURN_WRITE);
        const client = new DataHubClient({ config, identity });
        for (let i = 0; i < FIXTURE_EVENT_TYPES.length; i++) flushed = await flushOutbox({ db: prisma, config, context: ctx, client });
      }
      out({ candidateId, queued: queued.map((r) => ({ producerEventId: r.producerEventId, eventType: r.eventType, syncStatus: r.syncStatus })), flushed });
      return;
    }
    default:
      console.error("Usage: iam-dpos.ts config-check | bind-company | update-binding | issue-identity | list-identities | revoke-identity | fixture-run");
      process.exit(2);
  }
}

main()
  .catch((e) => {
    console.error(e && typeof e === "object" && "code" in e ? `${(e as { code: string }).code}: ${(e as Error).message}` : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
