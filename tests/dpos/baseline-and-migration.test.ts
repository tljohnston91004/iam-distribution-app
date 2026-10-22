import { PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  BASELINE_MIGRATION,
  STAGE_4A_MIGRATION,
  STAGE_4B_MIGRATION,
  STAGE_4C_MIGRATION,
  governedMigrate,
  governedRollbackStage4A,
  governedRollbackStage4B,
  governedRollbackStage4C,
  legacyFingerprint,
  legacyTableNames,
  listUserTables,
  stage4aTableNames,
  stage4bTableNames,
  stage4cTableNames,
  sqliteUrl,
} from "../../src/lib/dpos/migrate/governed-migrate";
import { REPO_ROOT } from "./helpers";

const BASELINE_COMMIT = "b48e212";
const git = (...args: string[]) => execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" }).trim();

const tmpDirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "iam4a-mig-"));
  tmpDirs.push(d);
  return d;
};
after(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function modelBlocks(schema: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of schema.replace(/\r\n/g, "\n").matchAll(/^(model|enum)\s+(\w+)\s*\{[\s\S]*?^\}/gm)) {
    out.set(`${m[1]} ${m[2]}`, m[0].split("\n").map((l) => l.trimEnd()).join("\n"));
  }
  return out;
}

describe("branch and V1.5 baseline preservation", () => {
  it("is on workshop/dpos-iam-integration, built from the V1.5 baseline, and IAM main is untouched", () => {
    assert.equal(git("rev-parse", "--abbrev-ref", "HEAD"), "workshop/dpos-iam-integration");
    const mergeBase = spawnSync("git", ["-C", REPO_ROOT, "merge-base", "--is-ancestor", BASELINE_COMMIT, "HEAD"]);
    assert.equal(mergeBase.status, 0, "baseline commit must be an ancestor of the workshop branch");
    assert.ok(git("rev-parse", "main").startsWith(BASELINE_COMMIT), "IAM main must remain at the V1.5 baseline commit");
  });

  it("recorded the V1.5 baseline before changing code", () => {
    const dir = path.join(REPO_ROOT, "docs", "dpos-integration", "baseline");
    assert.ok(fs.existsSync(path.join(dir, "schema.v1.5.prisma")), "schema.v1.5.prisma");
    assert.ok(fs.existsSync(path.join(dir, "V1_5_BASELINE.md")), "V1_5_BASELINE.md");
    const recorded = fs.readFileSync(path.join(dir, "schema.v1.5.prisma"), "utf8").replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
    const atBaseline = git("show", `${BASELINE_COMMIT}:prisma/schema.prisma`).replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
    assert.equal(recorded.trim(), atBaseline.trim(), "recorded baseline schema must equal the schema at the baseline commit");
  });

  it("keeps every V1.5 model and enum byte-identical (additive schema change only)", () => {
    const baseline = modelBlocks(git("show", `${BASELINE_COMMIT}:prisma/schema.prisma`));
    const current = modelBlocks(fs.readFileSync(path.join(REPO_ROOT, "prisma", "schema.prisma"), "utf8"));
    assert.ok(baseline.size >= 30, "baseline should contain the 30 V1.5 models");
    for (const [name, block] of baseline) {
      assert.ok(current.has(name), `V1.5 ${name} was removed`);
      assert.equal(current.get(name), block, `V1.5 ${name} was modified`);
    }
    const added = [...current.keys()].filter((k) => !baseline.has(k));
    assert.ok(added.length >= 34 && added.every((k) => /Dpos|IamCore/.test(k)), `unexpected new definitions: ${added.join(", ")}`);
  });

  it("the Stage 4A migration SQL only creates objects (no ALTER/DROP/DELETE/UPDATE on V1.5 tables)", () => {
    const sql = fs.readFileSync(path.join(REPO_ROOT, "prisma", "migrations", STAGE_4A_MIGRATION, "migration.sql"), "utf8");
    const legacy = legacyTableNames(REPO_ROOT);
    assert.equal(legacy.length, 30);
    assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i);
    assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
    for (const t of legacy) {
      assert.doesNotMatch(sql, new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|REFERENCES)\\s+"?${t}"?\\b`, "i"), `must not touch V1.5 table ${t}`);
    }
    assert.equal(stage4aTableNames(REPO_ROOT).length, 15);
    assert.ok(stage4aTableNames(REPO_ROOT).every((t) => !legacy.includes(t)), "no V1.5 table is re-created or repurposed");
  });

  it("the Stage 4B migration SQL is additive: new tables only, referencing Stage 4A candidates, never touching V1.5 or altering 4A", () => {
    const sql = fs.readFileSync(path.join(REPO_ROOT, "prisma", "migrations", STAGE_4B_MIGRATION, "migration.sql"), "utf8");
    const legacy = legacyTableNames(REPO_ROOT);
    assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i);
    assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(sql, /\bDROP\s+TRIGGER\b/i);
    for (const t of legacy) {
      assert.doesNotMatch(sql, new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|REFERENCES|FROM)\\s+"?${t}"?\\b`, "i"), `must not touch V1.5 table ${t}`);
    }
    for (const t of stage4aTableNames(REPO_ROOT)) {
      assert.doesNotMatch(sql, new RegExp(`(CREATE\\s+TABLE|INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+"?${t}"?\\b`, "i"), `must not rewrite Stage 4A table ${t}`);
    }
    const created = stage4bTableNames(REPO_ROOT);
    assert.equal(created.length, 13);
    assert.ok(created.every((t) => !legacy.includes(t) && !stage4aTableNames(REPO_ROOT).includes(t)));
  });

  it("the Stage 4C migration SQL is additive: new scoring tables only; it never touches V1.5, Stage 4A or Stage 4B tables", () => {
    const sql = fs.readFileSync(path.join(REPO_ROOT, "prisma", "migrations", STAGE_4C_MIGRATION, "migration.sql"), "utf8");
    const legacy = legacyTableNames(REPO_ROOT);
    assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i);
    assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(sql, /\bDROP\s+TRIGGER\b/i);
    for (const t of legacy) {
      assert.doesNotMatch(sql, new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|REFERENCES|FROM)\\s+"?${t}"?\\b`, "i"), `must not touch V1.5 table ${t}`);
    }
    for (const t of [...stage4aTableNames(REPO_ROOT), ...stage4bTableNames(REPO_ROOT)]) {
      assert.doesNotMatch(sql, new RegExp(`(CREATE\\s+TABLE|INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+"?${t}"?\\b`, "i"), `must not rewrite earlier-stage table ${t}`);
    }
    const created = stage4cTableNames(REPO_ROOT);
    assert.equal(created.length, 7);
    assert.deepEqual(
      [...created].sort(),
      ["iam_core_display_changes", "iam_core_emergency_reviews", "iam_core_forced_reviews", "iam_core_priority_governance", "iam_core_score_results", "iam_core_scoring_inputs", "iam_core_scoring_runs"],
    );
    assert.ok(created.every((t) => !legacy.includes(t)));
  });
});

describe("governed migration", () => {
  it("creates a new database with V1.5 + Stage 4A + Stage 4B + Stage 4C, records history, and is rerun-safe", async () => {
    const dir = tmp();
    const file = path.join(dir, "iam.db");
    const first = await governedMigrate({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.mode, "NEW_DATABASE");
    const tables = listUserTables(file);
    for (const t of [...legacyTableNames(REPO_ROOT), ...stage4aTableNames(REPO_ROOT), ...stage4bTableNames(REPO_ROOT), ...stage4cTableNames(REPO_ROOT)]) assert.ok(tables.includes(t), `missing table ${t}`);
    const second = await governedMigrate({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") });
    assert.equal(second.ok, true);
    assert.equal(second.mode, "ALREADY_CURRENT");
    assert.deepEqual(second.appliedMigrations, []);
    const db = new DatabaseSync(file, { readOnly: true });
    const names = (db.prepare("SELECT migration_name n FROM _prisma_migrations ORDER BY migration_name").all() as Array<{ n: string }>).map((r) => r.n);
    db.close();
    assert.deepEqual(names, [BASELINE_MIGRATION, STAGE_4A_MIGRATION, STAGE_4B_MIGRATION, STAGE_4C_MIGRATION]);
  });

  it("adopts a legacy `db push` V1.5 database without changing a single legacy row, then rolls back cleanly", async () => {
    const dir = tmp();
    const file = path.join(dir, "legacy.db");
    // Build a legacy-shaped database exactly the way V1.5 was created: baseline structure, no migration history.
    const baselineSql = fs.readFileSync(path.join(REPO_ROOT, "prisma", "migrations", BASELINE_MIGRATION, "migration.sql"), "utf8");
    const raw = new DatabaseSync(file);
    raw.exec(baselineSql);
    raw.close();
    const legacyPrisma = new PrismaClient({ datasources: { db: { url: sqliteUrl(file) } } });
    const company = await legacyPrisma.company.create({ data: { name: "Legacy Test Co" } });
    const run = await legacyPrisma.iamRun.create({
      data: { companyId: company.id, runName: "Legacy review cycle", reviewDate: new Date("2026-05-01"), reviewWeekStart: new Date("2026-04-27"), reviewWeekEnd: new Date("2026-05-03") },
    });
    await legacyPrisma.$disconnect();

    const before = legacyFingerprint(file, legacyTableNames(REPO_ROOT));
    const adopt = await governedMigrate({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") });
    assert.equal(adopt.ok, true, JSON.stringify(adopt));
    assert.equal(adopt.mode, "LEGACY_DB_PUSH_ADOPTED");
    assert.equal(adopt.legacyPreserved, true);
    assert.deepEqual(legacyFingerprint(file, legacyTableNames(REPO_ROOT)), before, "legacy rows must be identical after migration");
    assert.ok(adopt.backupFile && fs.existsSync(adopt.backupFile), "a backup is taken before changing a legacy database");

    // legacy records stay readable through the app's own models, and new tables exist alongside
    const after = new PrismaClient({ datasources: { db: { url: sqliteUrl(file) } } });
    assert.equal((await after.iamRun.findUnique({ where: { id: run.id } }))?.runName, "Legacy review cycle");
    assert.equal(await after.iamCoreCandidate.count(), 0, "legacy runs are NOT promoted to authoritative candidates");
    await after.$disconnect();

    // Reverse order: 4C first, then 4B, then 4A. Each earlier stage is refused while a later one is applied.
    const refused4b = await governedRollbackStage4B({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") });
    assert.equal(refused4b.ok, false);
    assert.match(String(refused4b.reason), /Stage 4C is applied/);
    const rollback4c = await governedRollbackStage4C({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") });
    assert.equal(rollback4c.ok, true, JSON.stringify(rollback4c));
    assert.equal(rollback4c.legacyPreserved, true);
    for (const t of stage4cTableNames(REPO_ROOT)) assert.ok(!listUserTables(file).includes(t), `${t} should be gone after the 4C rollback`);
    for (const t of stage4bTableNames(REPO_ROOT)) assert.ok(listUserTables(file).includes(t), `${t} (Stage 4B) must survive the 4C rollback`);
    const refused4a = await governedRollbackStage4A({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") });
    assert.equal(refused4a.ok, false);
    assert.match(String(refused4a.reason), /Stage 4B is applied/);
    const rollback4b = await governedRollbackStage4B({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") });
    assert.equal(rollback4b.ok, true, JSON.stringify(rollback4b));
    assert.equal(rollback4b.legacyPreserved, true);
    for (const t of stage4bTableNames(REPO_ROOT)) assert.ok(!listUserTables(file).includes(t), `${t} should be gone after the 4B rollback`);
    for (const t of stage4aTableNames(REPO_ROOT)) assert.ok(listUserTables(file).includes(t), `${t} (Stage 4A) must survive the 4B rollback`);
    const rollback = await governedRollbackStage4A({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") });
    assert.equal(rollback.ok, true, JSON.stringify(rollback));
    assert.equal(rollback.legacyPreserved, true);
    const tables = listUserTables(file);
    for (const t of stage4aTableNames(REPO_ROOT)) assert.ok(!tables.includes(t), `${t} should be gone after rollback`);
    assert.deepEqual(legacyFingerprint(file, legacyTableNames(REPO_ROOT)), before);

    const reapply = await governedMigrate({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") });
    assert.equal(reapply.ok, true, JSON.stringify(reapply));
    assert.deepEqual(legacyFingerprint(file, legacyTableNames(REPO_ROOT)), before);
  });

  it("refuses to roll back over integration data unless data loss is explicitly allowed", async () => {
    const dir = tmp();
    const file = path.join(dir, "iam.db");
    await governedMigrate({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") });
    const db = new DatabaseSync(file);
    db.exec(`INSERT INTO dpos_audit_events (audit_event_id, at, category, action, outcome) VALUES ('a1', 0, 'T', 'T', 'SUCCESS')`);
    db.close();
    const refused = await governedRollbackStage4A({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") });
    assert.equal(refused.ok, false);
    assert.ok(listUserTables(file).includes("dpos_audit_events"), "nothing is dropped when the guard refuses");
  });

  it("refuses a Stage 4B rollback over workflow data unless data loss is explicitly allowed, then removes only the 4B tables", async () => {
    const dir = tmp();
    const file = path.join(dir, "iam.db");
    await governedMigrate({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") });
    assert.equal((await governedRollbackStage4C({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") })).ok, true, "4C is reversed first");
    const db = new DatabaseSync(file);
    db.exec(`INSERT INTO iam_core_candidates (candidate_id, dpos_company_id, grouped_condition_key, lifecycle_state, original_created_at, created_at, updated_at) VALUES ('c1', 'co', 'K', 'CANDIDATE', 0, 0, 0)`);
    db.exec(`INSERT INTO iam_core_workflow_states (candidate_id, dpos_company_id, workflow_state, grouped_condition_key, created_at, updated_at) VALUES ('c1', 'co', 'NEW_CANDIDATE', 'K', 0, 0)`);
    db.close();
    const refused = await governedRollbackStage4B({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") });
    assert.equal(refused.ok, false);
    assert.ok(listUserTables(file).includes("iam_core_workflow_states"), "nothing is dropped when the guard refuses");
    const allowed = await governedRollbackStage4B({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk"), allowDataLoss: true });
    assert.equal(allowed.ok, true, JSON.stringify(allowed));
    assert.ok(!listUserTables(file).includes("iam_core_workflow_states"));
    assert.ok(listUserTables(file).includes("iam_core_candidates"), "the Stage 4A candidate table is untouched by the 4B rollback");
  });

  it("refuses a Stage 4C rollback over scoring data unless data loss is explicitly allowed, then removes only the 4C tables", async () => {
    const dir = tmp();
    const file = path.join(dir, "iam.db");
    await governedMigrate({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") });
    const db = new DatabaseSync(file);
    db.exec(`INSERT INTO iam_core_candidates (candidate_id, dpos_company_id, grouped_condition_key, lifecycle_state, original_created_at, created_at, updated_at) VALUES ('c1', 'co', 'K', 'CANDIDATE', 0, 0, 0)`);
    db.exec(`INSERT INTO iam_core_scoring_inputs (input_id, candidate_id, dpos_company_id, input_version, inputs_json, inputs_hash, recorded_by, recorded_at) VALUES ('i1', 'c1', 'co', 1, '{}', 'h', 'user-1', 0)`);
    db.close();
    const refused = await governedRollbackStage4C({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") });
    assert.equal(refused.ok, false);
    assert.ok(listUserTables(file).includes("iam_core_scoring_inputs"), "nothing is dropped when the guard refuses");
    const allowed = await governedRollbackStage4C({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk"), allowDataLoss: true });
    assert.equal(allowed.ok, true, JSON.stringify(allowed));
    assert.ok(!listUserTables(file).includes("iam_core_scoring_inputs"));
    assert.ok(listUserTables(file).includes("iam_core_workflow_states"), "the Stage 4B workflow table is untouched by the 4C rollback");
    assert.ok(listUserTables(file).includes("iam_core_candidates"), "the Stage 4A candidate table is untouched by the 4C rollback");
    // The data-loss rollback took a backup that still holds the scoring row.
    assert.ok(allowed.backupFile && fs.existsSync(allowed.backupFile));
    const bk = new DatabaseSync(allowed.backupFile, { readOnly: true });
    assert.equal((bk.prepare("SELECT COUNT(*) c FROM iam_core_scoring_inputs").get() as { c: number }).c, 1);
    bk.close();
  });

  it("a dry run changes nothing", async () => {
    const dir = tmp();
    const file = path.join(dir, "iam.db");
    const r = await governedMigrate({ databaseFile: file, repoRoot: REPO_ROOT, dryRun: true });
    assert.equal(r.ok, true);
    assert.equal(r.mode, "DRY_RUN");
    assert.equal(fs.existsSync(file) ? listUserTables(file).length : 0, 0);
  });
});
