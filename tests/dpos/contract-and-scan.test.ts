import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { checkContract } from "../../scripts/sync-dpos-contract";
import { findDposRoot, REPO_ROOT } from "./helpers";

const git = (...args: string[]) => execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8", maxBuffer: 50e6 }).trim();

function walk(dir: string, filter: (f: string) => boolean, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, filter, out);
    else if (filter(p)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(REPO_ROOT, p).replace(/\\/g, "/");

describe("shared Results Return contract", () => {
  it("the vendored contract equals its pin (CONTRACT-SOURCE.json)", () => {
    const r = checkContract();
    assert.deepEqual(r.problems, []);
  });
  it("the vendored contract equals the DPOS source when the DPOS repository is available (no drift)", { skip: findDposRoot() ? false : "DPOS repository not found" }, () => {
    const r = checkContract(findDposRoot()!);
    assert.deepEqual(r.problems, []);
  });
});

describe("repository guardrails", () => {
  const dposSources = () => walk(path.join(REPO_ROOT, "src", "lib", "dpos"), (f) => /\.(ts|tsx|json)$/.test(f));
  const integrationFiles = () => [
    ...dposSources(),
    ...walk(path.join(REPO_ROOT, "src", "app", "api", "dpos"), (f) => f.endsWith(".ts")),
    path.join(REPO_ROOT, "src", "instrumentation.ts"),
    path.join(REPO_ROOT, "scripts", "iam-migrate.ts"),
    path.join(REPO_ROOT, "scripts", "iam-dpos.ts"),
    path.join(REPO_ROOT, "scripts", "sync-dpos-contract.ts"),
  ];

  it("no local machine path, user name or credential is hard-coded in integration code", () => {
    for (const f of integrationFiles()) {
      const src = fs.readFileSync(f, "utf8");
      assert.doesNotMatch(src, /[A-Za-z]:[\\/]+Users[\\/]/i, `${rel(f)} must not contain a Windows user path`);
      assert.doesNotMatch(src, /\/Users\/|\/home\/[a-z]/, `${rel(f)} must not contain a home path`);
      assert.doesNotMatch(src, /Terry|Johnston/i, `${rel(f)} must not name a person`);
      assert.doesNotMatch(src, /Bearer\s+[A-Za-z0-9._-]{16,}/, `${rel(f)} must not embed a bearer token`);
      assert.doesNotMatch(src, /(secret|password|credential)\s*[:=]\s*["'][^"']{8,}["']/i, `${rel(f)} must not embed a secret value`);
    }
  });

  it("the committed .env.example has the integration block with no values for secrets", () => {
    const env = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
    assert.match(env, /IAM_DEPLOYMENT_MODE/);
    assert.doesNotMatch(env, /^\s*IAM_(DATA_HUB|FRONT_DOOR)_CREDENTIAL\s*=/m);
    assert.ok(!git("ls-files", ".env").length, ".env is never committed");
  });

  it("the two Data Hub service permission keys appear only where they are defined or deliberately used", () => {
    const hits = walk(REPO_ROOT, (f) => /\.(ts|tsx|js|mjs|json|md)$/.test(f) && !f.includes(`${path.sep}docs${path.sep}`))
      .filter((f) => fs.readFileSync(f, "utf8").includes("datahub.iam_results_return"))
      .map(rel)
      .sort();
    assert.deepEqual(hits, ["scripts/iam-dpos.ts", "src/lib/dpos/service-identity.ts", "tests/dpos/contract-and-scan.test.ts", "tests/dpos/service-identity.test.ts"].sort());
  });

  it("Stage 4A adds no user-facing screens, no scoring/ranking/recommendation logic, and leaves V1.5 UI components untouched", () => {
    const added = new Set<string>([
      ...git("diff", "--name-status", "--diff-filter=A", "b48e212", "--", "src/app", "src/components").split("\n").filter(Boolean).map((l) => l.split("\t")[1]!),
      ...git("ls-files", "--others", "--exclude-standard", "src/app", "src/components").split("\n").filter(Boolean),
    ]);
    const unexpected = [...added].filter((f) => !f.startsWith("src/app/api/dpos/") && f !== "src/instrumentation.ts");
    assert.deepEqual(unexpected, [], "only non-customer-facing /api/dpos endpoints may be added under src/app");
    assert.equal(git("diff", "--stat", "b48e212", "--", "src/components", "src/app/globals.css"), "", "no V1.5 component or stylesheet changed");
    assert.match(fs.readFileSync(path.join(REPO_ROOT, "src", "app", "page.tsx"), "utf8"), /Decision Priority · IAM Version 1\.5/);
    for (const f of dposSources()) {
      const src = fs.readFileSync(f, "utf8");
      assert.doesNotMatch(src, /from\s+["']@\/lib\/iam\/(scoring|engine|actions|lifecycle|presentation)/, `${rel(f)} must not use V1.5 scoring/engine code`);
      assert.doesNotMatch(src, /healthScore|InventoryManagementHealth|enterpriseRank|learningLoop/i, `${rel(f)} must not implement later-stage features`);
    }
  });

  it("the V1.5 scoring and lifecycle source is byte-identical to the baseline", () => {
    assert.equal(git("diff", "--stat", "b48e212", "--", "src/lib/iam"), "");
  });
});
