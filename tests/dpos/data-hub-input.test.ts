import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { DataHubClient, DataHubClientError, IAM_INPUT_FAMILY_LIST, type GovernedInputPage } from "../../src/lib/dpos/data-hub-client";
import { makeConfig, REPO_ROOT, uuid } from "./helpers";

const config = makeConfig({ DATA_HUB_BASE_URL: "http://hub.test:4000" });
const identity = { identityId: "iam-svc-" + uuid(), credentialRef: "IAM_TEST_CRED" };

function record(family: string, n: number, over: Record<string, unknown> = {}) {
  const po = family === "OPEN_PURCHASE_ORDER_LINE";
  return {
    canonicalRecordId: `crec-${family}-${n}`,
    businessKey: `bk-${n}`,
    version: 1,
    publicationStatus: "PUBLISHED",
    values: { parentSku: `SKU-${n}`, childPartOrVariant: ["10.0", "9.00", "02.0", null][n % 4], quantity: 5 + n, ...(po ? { vendor: "ACME" } : { customer: "C1" }), ...over },
    effectiveAt: "2026-10-01T00:00:00.000Z",
    observedAt: "2026-10-02T00:00:00.000Z",
    confidence: "HIGH",
    confidenceComponents: { source: "HIGH" },
    importBatchId: "batch-" + family,
    lineage: {
      lineageId: "lin-" + n,
      sourceSystemId: "keystroke",
      sourceObjectType: family,
      sourceRecordId: "row-" + n,
      sourceFileId: "file-1",
      sourceLocation: "row " + n,
      ingestionBatchId: "batch-" + family,
      mappingProfileId: "map-1",
      mappingProfileVersion: "1",
      transformationChainId: "chain-1",
      ingestedAt: "2026-10-02T00:00:01.000Z",
      canonicalizedAt: "2026-10-02T00:00:02.000Z",
    },
    quality: {
      confidenceStatus: "HIGH",
      confidenceScore: "0.95",
      completenessScore: "1.0",
      validationStatus: "VALID",
      freshnessStatus: "CURRENT",
      exceptionCount: 0,
      hasBlockingException: false,
      lastSourceUpdateAt: "2026-10-01T00:00:00.000Z",
      lastIngestedAt: "2026-10-02T00:00:01.000Z",
      lastValidatedAt: "2026-10-02T00:00:03.000Z",
      qualityRuleVersion: "q1",
      assessmentType: "AUTOMATED",
    },
  };
}

function hub(handler: (url: URL, init: RequestInit) => { status: number; body: unknown }) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchImpl = (async (input: unknown, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, client: new DataHubClient({ config, identity, fetchImpl, env: { IAM_TEST_CRED: "bearer-value" } }) };
}

function pagesFor(family: string, total: number, pageSize: number) {
  return (url: URL) => {
    const m = url.pathname.match(/iam-inputs\/([A-Z_]+)\/records$/);
    assert.ok(m, "records endpoint");
    const cursor = Number(url.searchParams.get("cursor") ?? 0);
    const records = Array.from({ length: Math.min(pageSize, total - cursor) }, (_, i) => record(m![1]!, cursor + i));
    const next = cursor + records.length < total ? String(cursor + records.length) : null;
    const body: GovernedInputPage = {
      companyId: config.dataHubCompanyId,
      family: m![1] as GovernedInputPage["family"],
      contractId: "IAM_INPUT_V1",
      contractVersion: "1.0.0",
      generatedAt: "2026-10-03T00:00:00.000Z",
      source: cursor === 0 ? { availability: "AVAILABLE" } : null,
      records,
      nextCursor: next,
    };
    return { status: 200, body };
  };
}

describe("Data Hub input client (governed inputs only)", () => {
  it("consumes exactly the two approved input families", () => {
    assert.deepEqual([...IAM_INPUT_FAMILY_LIST], ["OPEN_PURCHASE_ORDER_LINE", "CUSTOMER_BACKORDER_LINE"]);
  });

  for (const family of IAM_INPUT_FAMILY_LIST) {
    it(`reads ${family} page by page with parentSku=Stck# and childPartOrVariant=Class preserved verbatim`, async () => {
      const { client, calls } = hub(pagesFor(family, 5, 2));
      const got = [];
      for await (const r of client.iterateInputRecords(family, { pageSize: 2 })) got.push(r);
      assert.equal(got.length, 5);
      assert.equal(calls.length, 3, "three pages");
      assert.deepEqual(got.map((r) => r.values.parentSku), ["SKU-0", "SKU-1", "SKU-2", "SKU-3", "SKU-4"]);
      // Class is never normalized: "10.0", "9.00", "02.0" stay exactly as supplied; absent Class stays null
      assert.deepEqual(got.map((r) => r.values.childPartOrVariant), ["10.0", "9.00", "02.0", null, "10.0"]);
      for (const r of got) {
        assert.ok(r.importBatchId, "source run identity retained");
        assert.ok(r.lineage?.sourceRecordId && r.lineage.ingestionBatchId, "lineage/reference ids retained");
        assert.equal(r.quality?.freshnessStatus, "CURRENT", "freshness metadata retained");
        assert.equal(r.quality?.validationStatus, "VALID", "validation metadata retained");
        assert.ok(r.confidence && r.confidenceComponents, "confidence-support metadata retained");
        assert.ok(r.observedAt && r.effectiveAt);
      }
    });
  }

  it("addresses only the governed company endpoints and sends the service identity (never a user) with the company id", async () => {
    const { client, calls } = hub(pagesFor("OPEN_PURCHASE_ORDER_LINE", 1, 5));
    await client.readInputRecordsPage("OPEN_PURCHASE_ORDER_LINE", { limit: 5 });
    const { url, init } = calls[0]!;
    assert.equal(url.origin, "http://hub.test:4000");
    assert.equal(url.pathname, `/api/v1/companies/${config.dataHubCompanyId}/iam-inputs/OPEN_PURCHASE_ORDER_LINE/records`);
    const h = init.headers as Record<string, string>;
    assert.equal(h["x-identity-id"], identity.identityId);
    assert.match(h["x-user-id"]!, /^iam-svc-/);
    assert.equal(h["x-company-id"], config.dataHubCompanyId);
    assert.ok(h["x-correlation-id"]);
    assert.equal(h.authorization, "Bearer bearer-value");
  });

  it("rejects a response for a different company, a different family, and unsupported families", async () => {
    const wrong = hub((url) => ({ status: 200, body: { ...(pagesFor("OPEN_PURCHASE_ORDER_LINE", 1, 1)(url).body as object), companyId: uuid() } }));
    await assert.rejects(() => wrong.client.readInputRecordsPage("OPEN_PURCHASE_ORDER_LINE"), (e: unknown) => e instanceof DataHubClientError && e.code === "DATA_HUB_COMPANY_MISMATCH");
    const fam = hub((url) => ({ status: 200, body: { ...(pagesFor("OPEN_PURCHASE_ORDER_LINE", 1, 1)(url).body as object), family: "CUSTOMER_BACKORDER_LINE" } }));
    await assert.rejects(() => fam.client.readInputRecordsPage("OPEN_PURCHASE_ORDER_LINE"), (e: unknown) => e instanceof DataHubClientError && e.code === "FAMILY_MISMATCH");
    const none = hub(() => ({ status: 200, body: {} }));
    await assert.rejects(() => none.client.readInputRecordsPage("INVENTORY_ONHAND" as never), (e: unknown) => e instanceof DataHubClientError && e.code === "UNSUPPORTED_FAMILY");
    assert.equal(none.calls.length, 0, "an unsupported family never reaches Data Hub");
  });

  it("classifies failures: 401/403 configuration, 5xx/429 temporary, other 4xx data, network temporary", async () => {
    const run = async (status: number) => {
      const { client } = hub(() => ({ status, body: { error: { code: "X", message: "m" } } }));
      try {
        await client.getInputStatus();
      } catch (e) {
        return (e as DataHubClientError).category;
      }
      return "OK";
    };
    assert.equal(await run(403), "CONFIGURATION_SYSTEM");
    assert.equal(await run(401), "CONFIGURATION_SYSTEM");
    assert.equal(await run(503), "TEMPORARY_TECHNICAL");
    assert.equal(await run(429), "TEMPORARY_TECHNICAL");
    assert.equal(await run(404), "DATA_VALIDATION");
    const down = new DataHubClient({ config, identity, fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    await assert.rejects(() => down.getInputStatus(), (e: unknown) => e instanceof DataHubClientError && e.category === "TEMPORARY_TECHNICAL" && e.code === "NETWORK_ERROR");
  });

  it("has no raw Keystroke file dependency: the input client reads only governed Data Hub APIs", () => {
    const dir = path.join(REPO_ROOT, "src", "lib", "dpos");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(src, /from\s+["'](?:@\/lib\/iam\/(?:keystroke|ingest|adapters|upload)|xlsx|exceljs|csv-parse)/i, `${f} must not import Keystroke/file parsers`);
      assert.doesNotMatch(code, /Stck#|Trans#/, `${f} must not use raw Keystroke column names in code`);
    }
    const client = fs.readFileSync(path.join(dir, "data-hub-client.ts"), "utf8");
    assert.doesNotMatch(client, /node:fs|readFile|createReadStream/, "the Data Hub client must not read files");
  });
});
