/**
 * TEST / DEV TOOLING ONLY (Stage 4E). NOT part of the product and never bundled into or used by the customer runtime. It creates and
 * destroys its own throw-away temp state, uses synthetic fixtures, embeds no secrets, and must never be pointed at a customer database.
 *
 * Governed UPDATE proof for the IAM Stage 4E migration, from a POPULATED approved Stage 4D / 4D-R state database:
 *
 *   1  build a populated 4D-R-state database (V1.5 baseline + Stage 4A..4D applied, 4E absent) with candidates, workflow, scoring and
 *      Health rows; record every table's row count, column list and content digest
 *   2  dry run changes nothing
 *   3  a tampered / failing Stage 4E migration is refused: the governed migrator restores from its backup and the database is
 *      byte-for-byte the prior state (zero difference)
 *   4  retry through the governed update: the Stage 4E migration is applied exactly once, a backup was taken first
 *   5  preservation: every pre-existing table keeps its rows, columns and content digest; the new 4E tables are empty
 *   6  controlled rollback of Stage 4E only (rollback-4e) -> pre-existing tables identical; restore-from-backup -> zero difference
 *   7  re-apply succeeds; a repeat update is ALREADY_CURRENT and does not re-apply anything
 *   8  post-update validation on the migrated, populated database: integrity checks, immutability triggers present, and a real
 *      closeout lifecycle through to permanent closure
 *
 * Usage: DPOS_REPO_ROOT=<dpos worktree> npx tsx scripts/prove-stage4e-governed-update.ts [--evidence <dir>]
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  STAGE_4E_MIGRATION,
  governedMigrate,
  governedRollbackStage4E,
  listMigrationNames,
  listUserTables,
  restoreBackup,
  stage4eTableNames,
} from "../src/lib/dpos/migrate/governed-migrate";
import { approveCloseout, completeCloseout, recordLearning, recordMeasurement, startCloseout } from "../src/lib/dpos/closeout";
import { calculateHealth, recordHealthEvidence } from "../src/lib/dpos/health";
import { runScoring } from "../src/lib/dpos/scoring";
import { SYSTEM_ACTOR } from "../src/lib/dpos/workflow";
import { boundContext, createTestDb, makeConfig } from "../tests/dpos/helpers";
import { completedHistoryCandidate, measurement } from "../tests/dpos/closeout-helpers";
import { MANAGER, at } from "../tests/dpos/workflow-helpers";
import { P80, P41, fromPoints, scoredCandidate } from "../tests/dpos/scoring-helpers";

if (process.env.NODE_ENV === "production" || process.env.IAM_ENVIRONMENT_CLASS === "PRODUCTION") throw new Error("This proof is test tooling and refuses to run in a production environment.");
const REPO = process.cwd();
const argAt = process.argv.indexOf("--evidence");
const EVIDENCE = path.resolve(argAt >= 0 ? process.argv[argAt + 1]! : path.join(os.tmpdir(), "DPOS-STAGE4E-EVIDENCE"));
fs.mkdirSync(EVIDENCE, { recursive: true });

const results: Array<{ step: string; ok: boolean; detail: unknown }> = [];
function log(m: string) {
  const line = `[${new Date().toISOString()}] ${m}`;
  console.log(line);
  fs.appendFileSync(path.join(EVIDENCE, "e2e-4e.log"), `${line}\n`);
}
function check(step: string, ok: boolean, detail: unknown = null) {
  results.push({ step, ok, detail });
  log(`${ok ? "PASS" : "FAIL"}  ${step}`);
  if (!ok) log(`      ${JSON.stringify(detail).slice(0, 800)}`);
}
function save(name: string, value: unknown) {
  fs.writeFileSync(path.join(EVIDENCE, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

interface TableObs {
  rows: number;
  columns: string[];
  sha256: string;
}
type Obs = Record<string, TableObs>;

/** Row count, column list and content digest of EVERY user table (rows ordered by rowid; values stringified). */
function observe(file: string): Obs {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const out: Obs = {};
    for (const t of listUserTables(file)) {
      const columns = (db.prepare(`PRAGMA table_info("${t}")`).all() as Array<{ name: string }>).map((c) => c.name);
      const h = createHash("sha256");
      let rows = 0;
      for (const r of db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).iterate() as Iterable<Record<string, unknown>>) {
        rows++;
        h.update(JSON.stringify(columns.map((c) => (typeof r[c] === "bigint" ? String(r[c]) : r[c] instanceof Uint8Array ? Buffer.from(r[c] as Uint8Array).toString("hex") : r[c]))));
        h.update("\n");
      }
      out[t] = { rows, columns, sha256: h.digest("hex") };
    }
    return out;
  } finally {
    db.close();
  }
}
const diff = (a: Obs, b: Obs, ignore: string[] = []): string[] => {
  const out: string[] = [];
  for (const t of Object.keys(a)) {
    if (ignore.includes(t)) continue;
    if (!b[t]) out.push(`${t}: missing`);
    else if (a[t]!.sha256 !== b[t]!.sha256 || a[t]!.rows !== b[t]!.rows || a[t]!.columns.join() !== b[t]!.columns.join()) out.push(`${t}: changed`);
  }
  return out;
};
const fileSha = (f: string) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const applied = (file: string): string[] => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare(`SELECT migration_name n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`).all() as Array<{ n: string }>).map((r) => r.n);
  } finally {
    db.close();
  }
};
const count = (file: string, sql: string): number => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare(sql).get() as { c: number }).c;
  } finally {
    db.close();
  }
};
const MUTABLE = ["_prisma_migrations", "dpos_migration_records"];

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "iam4e-update-proof-"));
  const backups = path.join(work, "backups");
  try {
    // ---- 1. a populated 4D-R-state database ----------------------------------------------------------------------------------
    const tdb = await createTestDb();
    const ctx = await boundContext(tdb.prisma, makeConfig());
    const f = { db: tdb.prisma, ctx };
    await scoredCandidate(f, "p-high", fromPoints(P80));
    await scoredCandidate(f, "p-low", fromPoints(P41));
    await runScoring(tdb.prisma, ctx, SYSTEM_ACTOR, { at: at(0, 6), runKey: "proof-w1" });
    const refs = { sourceRefs: ["rse-run-proof"], asOf: at(7), at: at(7) };
    await recordHealthEvidence(tdb.prisma, ctx, MANAGER, "POSITION_BALANCE", { totalInventoryBookValue: 1000, belowMinExposureValue: 50, aboveMaxExcessValue: 150 }, refs);
    await recordHealthEvidence(tdb.prisma, ctx, MANAGER, "COMPANY_FACTS", { turnsTarget: 4, averageWeeklyRevenue: 100000 }, { sourceRefs: ["company-governance-1"], at: at(7) });
    await calculateHealth(tdb.prisma, ctx, MANAGER, { at: at(7), backorder: { fetch: async () => ({ ok: false, reason: "Customer Backorder feed not supplied." }) } });
    const history = await completedHistoryCandidate(f, { key: "proof-hist" });
    await tdb.prisma.$disconnect();

    const file = path.join(work, "iam-4dr.db");
    fs.copyFileSync(tdb.file, file);
    // The 4E tables hold no rows yet, so rolling them back is lossless: this IS the approved 4D-R state.
    const down = await governedRollbackStage4E({ databaseFile: file, repoRoot: REPO, backupDir: path.join(work, "bk-build") });
    check("1 a populated Stage 4D/4D-R-state database was built (4E absent, 4A-4D present)", down.ok && !stage4eTableNames(REPO).some((t) => listUserTables(file).includes(t)) && applied(file).length === listMigrationNames(REPO).length - 1, { ok: down.ok, applied: applied(file) });
    const O0 = observe(file);
    const appliedBefore = applied(file);
    const shaPre = fileSha(file);
    const populated = ["iam_core_candidates", "iam_core_workflow_states", "iam_core_scoring_runs", "iam_core_health_scores"].map((t) => [t, O0[t]?.rows ?? -1] as const);
    check("1 the state is populated (candidates, workflow, scoring and Health rows)", populated.every(([, n]) => n > 0), populated);
    save("01-pre-stage4e-state", { applied: applied(file), tables: O0, fileSha256: fileSha(file), completedHistoryCandidate: history });

    // ---- 2. dry run -------------------------------------------------------------------------------------------------------------
    const dry = await governedMigrate({ databaseFile: file, repoRoot: REPO, backupDir: backups, dryRun: true });
    check("2 a dry run reports the Stage 4E migration and changes nothing", dry.ok && dry.mode === "DRY_RUN" && dry.appliedMigrations.join() === STAGE_4E_MIGRATION && diff(O0, observe(file)).length === 0 && fileSha(file) === shaPre, dry);

    // ---- 3. controlled failure after part of the migration is applied -> exact restore ---------------------------------------------
    const bad = path.join(work, "broken-release");
    fs.mkdirSync(bad, { recursive: true });
    fs.cpSync(path.join(REPO, "prisma"), path.join(bad, "prisma"), { recursive: true });
    fs.symlinkSync(path.join(REPO, "node_modules"), path.join(bad, "node_modules"), "junction");
    const brokenSql = path.join(bad, "prisma", "migrations", STAGE_4E_MIGRATION, "migration.sql");
    fs.appendFileSync(brokenSql, "\n-- tampered release: a statement that fails after the tables above were created\nCREATE TABLE \"iam_core_closeouts\" (\"x\" TEXT);\n");
    const shaBefore = fileSha(file);
    const failed = await governedMigrate({ databaseFile: file, repoRoot: bad, backupDir: backups });
    save("03-controlled-failure-and-rollback", failed);
    check("3 the failing Stage 4E release is refused and the database is restored from the pre-migration backup", !failed.ok && failed.mode === "FAILED" && failed.restoredFromBackup === true && !!failed.backupFile, failed);
    const afterFail = observe(file);
    check("3 zero difference after the failed update: every table identical, 4E tables absent, migration list unchanged", diff(O0, afterFail).length === 0 && Object.keys(afterFail).length === Object.keys(O0).length && applied(file).join() === appliedBefore.join() && !stage4eTableNames(REPO).some((t) => afterFail[t]), { diff: diff(O0, afterFail), fileChanged: fileSha(file) !== shaBefore });
    check("3 the failed attempt left no Stage 4E migration record", !applied(file).includes(STAGE_4E_MIGRATION), applied(file));

    // ---- 4. retry through the governed update: applied exactly once ------------------------------------------------------------------
    const upd = await governedMigrate({ databaseFile: file, repoRoot: REPO, backupDir: backups });
    save("04-governed-update", upd);
    check("4 the retry succeeds: a backup was taken first and the Stage 4E migration is applied", upd.ok && upd.mode === "MIGRATED_DATABASE_UPDATED" && !!upd.backupFile && fs.existsSync(upd.backupFile!) && upd.appliedMigrations.includes(STAGE_4E_MIGRATION), upd);
    check("4 the Stage 4E migration is recorded exactly once", count(file, `SELECT COUNT(*) c FROM _prisma_migrations WHERE migration_name='${STAGE_4E_MIGRATION}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`) === 1);

    // ---- 5. preservation -----------------------------------------------------------------------------------------------------------
    const O1 = observe(file);
    const changed = diff(O0, O1, MUTABLE);
    check("5 every pre-existing table keeps its rows, columns and content digest", changed.length === 0, changed);
    const fresh = stage4eTableNames(REPO);
    check("5 the new Stage 4E tables exist and are empty", fresh.length > 0 && fresh.every((t) => O1[t] && O1[t]!.rows === 0), fresh.map((t) => [t, O1[t]?.rows]));
    check("5 the governed migration ledger gained exactly one record", (O1.dpos_migration_records?.rows ?? 0) === (O0.dpos_migration_records?.rows ?? 0) + 1, { before: O0.dpos_migration_records?.rows, after: O1.dpos_migration_records?.rows });
    save("05-preservation", { newTables: fresh, rowsBefore: Object.fromEntries(Object.entries(O0).map(([k, v]) => [k, v.rows])), rowsAfter: Object.fromEntries(Object.entries(O1).map(([k, v]) => [k, v.rows])) });

    // ---- 6. controlled rollback of 4E only, and restore-from-backup ------------------------------------------------------------------------
    const rb = await governedRollbackStage4E({ databaseFile: file, repoRoot: REPO, backupDir: backups });
    const afterRb = observe(file);
    save("06-controlled-rollback", rb);
    check("6 the controlled Stage 4E rollback succeeds and removes only the 4E tables", rb.ok && fresh.every((t) => !afterRb[t]), rb);
    check("6 after the rollback every pre-existing table is identical to the approved Stage 4D/4D-R state", diff(O0, afterRb, MUTABLE).length === 0, diff(O0, afterRb, MUTABLE));
    restoreBackup(upd.backupFile!, file);
    const restored = observe(file);
    check("6 restoring the pre-update backup gives zero difference (every table, including the migration ledger)", diff(O0, restored).length === 0 && applied(file).join() === appliedBefore.join() && !applied(file).includes(STAGE_4E_MIGRATION), diff(O0, restored));

    // ---- 7. retry success after rollback; already current ------------------------------------------------------------------------------
    const retry = await governedMigrate({ databaseFile: file, repoRoot: REPO, backupDir: backups });
    check("7 the update succeeds again after the rollback / restore", retry.ok && retry.appliedMigrations.includes(STAGE_4E_MIGRATION), retry);
    const ledgerBefore = count(file, "SELECT COUNT(*) c FROM dpos_migration_records");
    const shaCurrent = fileSha(file);
    const again = await governedMigrate({ databaseFile: file, repoRoot: REPO, backupDir: backups });
    save("07-after-rerun", again);
    check("7 a repeat update is ALREADY_CURRENT: nothing re-applied, no new ledger record, file unchanged", again.ok && again.mode === "ALREADY_CURRENT" && again.appliedMigrations.length === 0 && count(file, "SELECT COUNT(*) c FROM dpos_migration_records") === ledgerBefore && fileSha(file) === shaCurrent, again);

    // ---- 8. post-update validation on the migrated, populated database --------------------------------------------------------------------------
    const raw = new DatabaseSync(file, { readOnly: true });
    const integrity = (raw.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    const fk = raw.prepare("PRAGMA foreign_key_check").all();
    const triggers = (raw.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '%closeout%'").all() as Array<{ name: string }>).map((r) => r.name);
    raw.close();
    check("8 integrity_check is ok, there are no foreign-key violations, and the closeout immutability triggers exist", integrity === "ok" && fk.length === 0 && triggers.length >= 3, { integrity, fk: fk.length, triggers });

    const { PrismaClient } = await import("@prisma/client");
    const { sqliteUrl } = await import("../src/lib/dpos/migrate/governed-migrate");
    const prisma = new PrismaClient({ datasources: { db: { url: sqliteUrl(file) } } });
    try {
      const f2 = { db: prisma, ctx };
      await startCloseout(f2.db, ctx, MANAGER, history, { at: at(29) });
      await recordMeasurement(f2.db, ctx, MANAGER, history, measurement({ at: at(30) }));
      await approveCloseout(f2.db, ctx, MANAGER, history, { finalStatus: "FULLY_RESOLVED", at: at(31) });
      await recordLearning(f2.db, ctx, MANAGER, history, { whatWorked: "Early vendor contact.", evidenceRefs: ["ev-final-balance-1"], at: at(32) });
      await completeCloseout(f2.db, ctx, MANAGER, history, { at: at(33) });
      const co = await prisma.iamCoreCloseout.findFirstOrThrow({ where: { candidateId: history } });
      const types = (await prisma.dposResultsReturnOutbox.findMany({ where: { candidateId: history } })).map((r) => r.eventType);
      check("8 the pre-existing Completed History candidate is permanently closed through the real closeout lifecycle on the migrated database", co.status === "CLOSED" && co.finalResolutionStatus === "FULLY_RESOLVED" && ["CLOSEOUT_STARTED", "CLOSEOUT_APPROVED", "LEARNING_RECORDED", "CLOSEOUT_COMPLETED"].every((e) => types.includes(e)), { status: co.status, final: co.finalResolutionStatus });
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  const failedChecks = results.filter((r) => !r.ok);
  save("e2e-summary", { generatedAt: new Date().toISOString(), passed: results.length - failedChecks.length, failed: failedChecks.length, results });
  log(`${results.length - failedChecks.length}/${results.length} checks passed`);
  process.exit(failedChecks.length ? 1 : 0);
}

main().catch((e) => {
  console.error("PROOF FAILED", e);
  process.exit(2);
});
