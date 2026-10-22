/**
 * IAM regression harness (DPOS Stage 4A/4B/4C).
 *
 * Runs the existing V1.5 test scripts (unchanged) against an ISOLATED temporary SQLite database so that no test ever
 * touches data/iam.db. The database is built either:
 *   --baseline-only   from the V1.5 baseline migration only (the pre-Stage-4A structure), or
 *   (default)         with the full governed migration chain (V1.5 baseline + Stage 4A + Stage 4B + Stage 4C).
 *
 * Usage: npx tsx scripts/run-iam-regression.ts [--baseline-only] [--only name1,name2] [--json out.json]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BASELINE_MIGRATION, governedMigrate } from "../src/lib/dpos/migrate/governed-migrate";

const REPO = path.resolve(__dirname, "..");

/** Existing V1.5 test scripts, in the same order as the package.json test:* scripts. */
export const V15_TEST_SCRIPTS: Array<{ name: string; script: string; args?: string[] }> = [
  { name: "validate:unit", script: "run-validation.ts", args: ["--unit-only"] },
  { name: "test:phase1-inbound", script: "run-phase1-inbound-tests.ts" },
  { name: "test:phase2-keystroke", script: "run-phase2-keystroke-adapter-tests.ts" },
  { name: "test:phase2-closure", script: "run-phase2-architecture-closure-tests.ts" },
  { name: "test:phase3-lifecycle", script: "run-phase3-lifecycle-tests.ts" },
  { name: "test:phase3-closure", script: "run-phase3-closure-tests.ts" },
  { name: "test:phase4-scoring", script: "run-phase4-scoring-tests.ts" },
  { name: "test:phase5-board", script: "run-phase5-board-tests.ts" },
  { name: "test:phase5a-experience", script: "run-phase5a-experience-tests.ts" },
  { name: "test:unified-ingestion", script: "run-unified-ingestion-tests.ts" },
  { name: "test:classification-segment", script: "run-classification-segment-tests.ts" },
  { name: "test:prescribed-action-plan", script: "run-prescribed-action-plan-tests.ts" },
  { name: "test:revised-scoring", script: "run-revised-scoring-tests.ts" },
  { name: "test:coi", script: "run-coi-tests.ts" },
  { name: "test:carrying-cost-rate", script: "run-carrying-cost-rate-tests.ts" },
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const baselineOnly = process.argv.includes("--baseline-only");
  const only = arg("--only")?.split(",");
  const jsonOut = arg("--json");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "iam-regress-"));
  const dbFile = path.join(work, "iam.db");
  const dataDir = path.join(work, "data");
  const uploadDir = path.join(work, "uploads");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  if (baselineOnly) {
    const db = new DatabaseSync(dbFile);
    db.exec(
      fs.readFileSync(path.join(REPO, "prisma", "migrations", BASELINE_MIGRATION, "migration.sql"), "utf8"),
    );
    db.close();
  } else {
    const r = await governedMigrate({ databaseFile: dbFile, repoRoot: REPO, backupDir: path.join(work, "backups") });
    if (!r.ok) {
      console.error("governed migrate failed", r);
      process.exit(2);
    }
  }
  console.log(`# IAM regression — DB mode: ${baselineOnly ? "V1.5 baseline only" : "baseline + Stage 4A + Stage 4B + Stage 4C"}`);
  console.log(`# Isolated DB: ${dbFile}`);

  const results: Array<{ name: string; exitCode: number | null; seconds: number; tail: string }> = [];
  for (const t of V15_TEST_SCRIPTS) {
    if (only && !only.includes(t.name)) continue;
    const started = Date.now();
    const p = spawnSync(
      process.execPath,
      [path.join(REPO, "node_modules", "tsx", "dist", "cli.mjs"), path.join("scripts", t.script), ...(t.args ?? [])],
      {
        cwd: REPO,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        env: {
          ...process.env,
          DATABASE_URL: `file:${dbFile.replace(/\\/g, "/")}`,
          IAM_DATA_DIR: dataDir,
          IAM_UPLOAD_DIR: uploadDir,
        },
      },
    );
    const out = `${p.stdout ?? ""}${p.stderr ?? ""}`;
    const tail = out.trim().split(/\r?\n/).slice(-3).join(" | ").slice(0, 300);
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    results.push({ name: t.name, exitCode: p.status, seconds, tail });
    console.log(`${p.status === 0 ? "PASS" : "FAIL"}  ${t.name.padEnd(30)} exit=${p.status} ${seconds}s  ${tail}`);
  }
  const failed = results.filter((r) => r.exitCode !== 0);
  console.log(`# ${results.length - failed.length}/${results.length} scripts passed`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ baselineOnly, results }, null, 2));
  try {
    fs.rmSync(work, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
