/**
 * Governed migration runner for the DPOS-integrated IAM (Stage 4A).
 *
 * IMPORTANT: this module uses `node:sqlite` and child processes. It is for scripts, tests and operator tooling ONLY —
 * it must never be imported from the Next.js application bundle.
 *
 * Guarantees:
 *   - Migrations are additive (Stage 4A creates new tables only); V1.5 tables are never altered or dropped.
 *   - Before any change to an existing database a verified backup copy is taken.
 *   - A V1.5 database created with `prisma db push` (no `_prisma_migrations`) is only adopted after its structure is
 *     proven equal to the V1.5 baseline migration (otherwise the run is refused — nothing is guessed).
 *   - A fingerprint (row count + order-independent row digest) of every V1.5 table is taken before and after; if it
 *     differs the backup is restored automatically and the run reports failure.
 *   - Re-running is safe (idempotent): nothing pending means nothing changes.
 *   - Reversal is a documented operation (`governedRollbackStage4A`): backup, guard against discarding integration
 *     data, run down.sql, un-record the migration, re-verify the legacy fingerprint.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const BASELINE_MIGRATION = "20260724000000_v1_5_baseline";
export const STAGE_4A_MIGRATION = "20261021100000_stage4a_core_integration_foundation";
export const STAGE_4B_MIGRATION = "20261021140000_stage4b_workflow";
export const STAGE_4C_MIGRATION = "20261021200000_stage4c_scoring";
export const STAGE_4D_MIGRATION = "20261022100000_stage4d_health_board";

export interface GovernedMigrateOptions {
  /** Absolute path of the SQLite file (created when absent). */
  databaseFile: string;
  repoRoot: string;
  /** Where backups are written. Defaults to `<db dir>/backups`. */
  backupDir?: string;
  /** Evaluate and report only; change nothing. */
  dryRun?: boolean;
  now?: () => Date;
}

export interface LegacyTableFingerprint {
  rows: number;
  digest: string;
}

export interface GovernedMigrateResult {
  ok: boolean;
  /** NEW_DATABASE | LEGACY_DB_PUSH_ADOPTED | MIGRATED_DATABASE_UPDATED | ALREADY_CURRENT | DRY_RUN | REFUSED | FAILED */
  mode: string;
  reason?: string;
  appliedMigrations: string[];
  backupFile?: string;
  legacyTableCount: number;
  legacyDigestBefore?: string;
  legacyDigestAfter?: string;
  legacyPreserved?: boolean;
  restoredFromBackup?: boolean;
  log: string[];
}

export function sqliteUrl(file: string): string {
  return `file:${path.resolve(file).replace(/\\/g, "/")}`;
}

function migrationsDir(repoRoot: string): string {
  return path.join(repoRoot, "prisma", "migrations");
}

export function listMigrationNames(repoRoot: string): string[] {
  return fs
    .readdirSync(migrationsDir(repoRoot), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** Names of the V1.5 tables, derived from the baseline migration (never hard-coded). */
export function legacyTableNames(repoRoot: string): string[] {
  const sql = fs.readFileSync(path.join(migrationsDir(repoRoot), BASELINE_MIGRATION, "migration.sql"), "utf8");
  return [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]!).sort();
}

function openReadOnly(file: string): DatabaseSync {
  return new DatabaseSync(file, { readOnly: true });
}

export function listUserTables(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  const db = openReadOnly(file);
  try {
    return (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
  } finally {
    db.close();
  }
}

function normalizeCell(v: unknown): unknown {
  if (typeof v === "bigint") return `bigint:${v.toString()}`;
  if (v instanceof Uint8Array) return `blob:${Buffer.from(v).toString("hex")}`;
  return v;
}

/** Row count + order-independent digest of one table's full contents. */
export function fingerprintTable(db: DatabaseSync, table: string): LegacyTableFingerprint {
  const stmt = db.prepare(`SELECT * FROM "${table}"`);
  let rows = 0;
  let acc = BigInt(0);
  const MASK = (BigInt(1) << BigInt(64)) - BigInt(1);
  for (const row of stmt.iterate() as Iterable<Record<string, unknown>>) {
    rows += 1;
    const h = createHash("sha1").update(JSON.stringify(Object.values(row).map(normalizeCell))).digest();
    acc = (acc + h.readBigUInt64BE(0)) & MASK;
  }
  return { rows, digest: acc.toString(16).padStart(16, "0") };
}

export function legacyFingerprint(file: string, tables: string[]): Record<string, LegacyTableFingerprint> {
  const out: Record<string, LegacyTableFingerprint> = {};
  const db = openReadOnly(file);
  try {
    const present = new Set(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>).map((r) => r.name),
    );
    for (const t of tables) if (present.has(t)) out[t] = fingerprintTable(db, t);
  } finally {
    db.close();
  }
  return out;
}

export function combineFingerprint(fp: Record<string, LegacyTableFingerprint>): string {
  const h = createHash("sha256");
  for (const t of Object.keys(fp).sort()) h.update(`${t}:${fp[t]!.rows}:${fp[t]!.digest};`);
  return h.digest("hex");
}

function runPrisma(repoRoot: string, args: string[], databaseFile: string) {
  const cli = path.join(repoRoot, "node_modules", "prisma", "build", "index.js");
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, DATABASE_URL: sqliteUrl(databaseFile) },
  });
}

function appliedMigrationNames(file: string): string[] | null {
  if (!fs.existsSync(file)) return null;
  const db = openReadOnly(file);
  try {
    const has = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'`).get();
    if (!has) return null;
    return (
      db
        .prepare(`SELECT migration_name AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`)
        .all() as Array<{ n: string }>
    ).map((r) => r.n);
  } finally {
    db.close();
  }
}

/** Proves that a `db push` legacy database has exactly the V1.5 baseline structure. */
export function legacyStructureEqualsBaseline(
  repoRoot: string,
  legacyFile: string,
): { equal: boolean; detail: string } {
  const tmp = path.join(os.tmpdir(), `iam-baseline-proof-${randomUUID()}.db`);
  try {
    const db = new DatabaseSync(tmp);
    db.exec(fs.readFileSync(path.join(migrationsDir(repoRoot), BASELINE_MIGRATION, "migration.sql"), "utf8"));
    db.close();
    const r = runPrisma(
      repoRoot,
      ["migrate", "diff", "--from-url", sqliteUrl(legacyFile), "--to-url", sqliteUrl(tmp), "--exit-code"],
      legacyFile,
    );
    if (r.status === 0) return { equal: true, detail: "structure identical to V1.5 baseline migration" };
    return { equal: false, detail: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().slice(0, 2000) };
  } finally {
    for (const f of [tmp, `${tmp}-journal`]) fs.rmSync(f, { force: true });
  }
}

function backup(file: string, backupDir: string, label: string, now: Date): string {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `${path.basename(file)}.${label}.${stamp}.bak`);
  // Use SQLite's own consistent copy so WAL/journal state cannot produce a torn backup.
  const db = openReadOnly(file);
  try {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } catch {
    db.close();
    fs.copyFileSync(file, target);
    return target;
  }
  db.close();
  return target;
}

export function restoreBackup(backupFile: string, databaseFile: string): void {
  for (const suffix of ["-journal", "-wal", "-shm"]) fs.rmSync(`${databaseFile}${suffix}`, { force: true });
  fs.copyFileSync(backupFile, databaseFile);
}

function recordMigration(
  file: string,
  rec: {
    migrationName: string;
    startedAt: Date;
    completedAt: Date;
    outcome: string;
    backupFile?: string;
    before?: string;
    after?: string;
    legacyTableCount: number;
    notes?: string;
  },
) {
  const db = new DatabaseSync(file);
  try {
    const has = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='dpos_migration_records'`).get();
    if (!has) return;
    db.prepare(
      `INSERT INTO dpos_migration_records
         (migration_record_id, migration_name, started_at, completed_at, outcome, backup_file,
          legacy_digest_before, legacy_digest_after, legacy_table_count, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      rec.migrationName,
      rec.startedAt.getTime(),
      rec.completedAt.getTime(),
      rec.outcome,
      rec.backupFile ?? null,
      rec.before ?? null,
      rec.after ?? null,
      rec.legacyTableCount,
      rec.notes ?? null,
    );
  } finally {
    db.close();
  }
}

export async function governedMigrate(opts: GovernedMigrateOptions): Promise<GovernedMigrateResult> {
  const now = opts.now ?? (() => new Date());
  const startedAt = now();
  const repoRoot = path.resolve(opts.repoRoot);
  const databaseFile = path.resolve(opts.databaseFile);
  const backupDir = opts.backupDir ?? path.join(path.dirname(databaseFile), "backups");
  const log: string[] = [];
  const legacyTables = legacyTableNames(repoRoot);
  const result: GovernedMigrateResult = {
    ok: false,
    mode: "FAILED",
    appliedMigrations: [],
    legacyTableCount: legacyTables.length,
    log,
  };
  const known = listMigrationNames(repoRoot);

  const exists = fs.existsSync(databaseFile) && fs.statSync(databaseFile).size > 0;
  const tables = exists ? listUserTables(databaseFile) : [];
  const applied = exists ? appliedMigrationNames(databaseFile) : null;

  // ---- classify the starting state ------------------------------------------------------------------------------
  let mode: "NEW_DATABASE" | "LEGACY_DB_PUSH_ADOPTED" | "MIGRATED_DATABASE_UPDATED";
  if (!exists || tables.length === 0) {
    mode = "NEW_DATABASE";
  } else if (applied === null) {
    // Existing tables but no migration history => created by `prisma db push` (V1.5). Adopt only if proven equal.
    const missing = legacyTables.filter((t) => !tables.includes(t));
    if (missing.length) {
      return { ...result, mode: "REFUSED", reason: `Existing database is missing V1.5 tables: ${missing.join(", ")}`, log };
    }
    const extra = tables.filter((t) => !legacyTables.includes(t));
    if (extra.length) {
      return { ...result, mode: "REFUSED", reason: `Existing database has unrecognised tables and no migration history: ${extra.join(", ")}`, log };
    }
    const proof = legacyStructureEqualsBaseline(repoRoot, databaseFile);
    log.push(`baseline structural proof: ${proof.detail}`);
    if (!proof.equal) {
      return { ...result, mode: "REFUSED", reason: "Existing database structure differs from the V1.5 baseline; refusing to adopt.", log };
    }
    mode = "LEGACY_DB_PUSH_ADOPTED";
  } else {
    const unknown = applied.filter((n) => !known.includes(n));
    if (unknown.length) {
      return { ...result, mode: "REFUSED", reason: `Database has migrations unknown to this build: ${unknown.join(", ")}`, log };
    }
    mode = "MIGRATED_DATABASE_UPDATED";
  }

  const pending = known.filter((n) => !(applied ?? []).includes(n));
  const willApply = mode === "LEGACY_DB_PUSH_ADOPTED" ? known.filter((n) => n !== BASELINE_MIGRATION && !(applied ?? []).includes(n)) : pending;

  if (opts.dryRun) {
    return { ...result, ok: true, mode: "DRY_RUN", reason: `would run mode=${mode}; would apply: ${willApply.join(", ") || "(nothing)"}`, appliedMigrations: willApply, log };
  }
  if (mode === "MIGRATED_DATABASE_UPDATED" && pending.length === 0) {
    const fp = legacyFingerprint(databaseFile, legacyTables);
    return { ...result, ok: true, mode: "ALREADY_CURRENT", legacyDigestAfter: combineFingerprint(fp), legacyDigestBefore: combineFingerprint(fp), legacyPreserved: true, log };
  }

  // ---- backup + fingerprint before -----------------------------------------------------------------------------
  let backupFile: string | undefined;
  let before: Record<string, LegacyTableFingerprint> = {};
  if (mode !== "NEW_DATABASE") {
    backupFile = backup(databaseFile, backupDir, mode === "LEGACY_DB_PUSH_ADOPTED" ? "pre-adopt" : "pre-migrate", startedAt);
    before = legacyFingerprint(databaseFile, legacyTables);
    log.push(`backup: ${backupFile}`);
  }
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });

  // ---- baseline the legacy database (record, not execute, the baseline migration) -------------------------------
  if (mode === "LEGACY_DB_PUSH_ADOPTED") {
    const r = runPrisma(repoRoot, ["migrate", "resolve", "--applied", BASELINE_MIGRATION], databaseFile);
    log.push(`resolve baseline: exit=${r.status}`);
    if (r.status !== 0) {
      if (backupFile) restoreBackup(backupFile, databaseFile);
      return { ...result, mode: "FAILED", reason: `prisma migrate resolve failed: ${(r.stderr ?? "").slice(0, 1500)}`, backupFile, restoredFromBackup: !!backupFile, log };
    }
  }

  // ---- deploy ---------------------------------------------------------------------------------------------------
  const deploy = runPrisma(repoRoot, ["migrate", "deploy"], databaseFile);
  log.push(`migrate deploy: exit=${deploy.status}`);
  if (deploy.status !== 0) {
    if (backupFile) restoreBackup(backupFile, databaseFile);
    else fs.rmSync(databaseFile, { force: true });
    return {
      ...result,
      mode: "FAILED",
      reason: `prisma migrate deploy failed: ${`${deploy.stdout ?? ""}${deploy.stderr ?? ""}`.slice(0, 2000)}`,
      backupFile,
      restoredFromBackup: true,
      log,
    };
  }

  // ---- fingerprint after / preservation check ------------------------------------------------------------------
  const after = legacyFingerprint(databaseFile, legacyTables);
  const beforeDigest = mode === "NEW_DATABASE" ? undefined : combineFingerprint(before);
  const afterDigest = combineFingerprint(after);
  const preserved = mode === "NEW_DATABASE" ? true : beforeDigest === afterDigest;
  if (!preserved) {
    if (backupFile) restoreBackup(backupFile, databaseFile);
    return {
      ...result,
      mode: "FAILED",
      reason: "V1.5 data fingerprint changed during migration; database restored from backup.",
      backupFile,
      legacyDigestBefore: beforeDigest,
      legacyDigestAfter: afterDigest,
      legacyPreserved: false,
      restoredFromBackup: true,
      log,
    };
  }
  const nowApplied = appliedMigrationNames(databaseFile) ?? [];
  const completedAt = now();
  for (const m of nowApplied.filter((n) => willApply.includes(n) || (mode === "NEW_DATABASE" && n === BASELINE_MIGRATION))) {
    recordMigration(databaseFile, {
      migrationName: m,
      startedAt,
      completedAt,
      outcome: "APPLIED",
      backupFile,
      before: beforeDigest,
      after: afterDigest,
      legacyTableCount: legacyTables.length,
      notes: mode,
    });
  }
  return {
    ok: true,
    mode,
    appliedMigrations: nowApplied,
    backupFile,
    legacyTableCount: legacyTables.length,
    legacyDigestBefore: beforeDigest,
    legacyDigestAfter: afterDigest,
    legacyPreserved: true,
    log,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reversal
// ---------------------------------------------------------------------------------------------------------------------

export interface RollbackOptions {
  databaseFile: string;
  repoRoot: string;
  backupDir?: string;
  /** Required to proceed when integration tables contain rows (they would be discarded; the backup retains them). */
  allowDataLoss?: boolean;
  now?: () => Date;
}

export interface RollbackResult {
  ok: boolean;
  reason?: string;
  backupFile?: string;
  discardedRows?: Record<string, number>;
  legacyPreserved?: boolean;
}

/** Tables created by a stage migration (derived from its SQL; never hard-coded). */
function migrationTableNames(repoRoot: string, migration: string): string[] {
  const sql = fs.readFileSync(path.join(migrationsDir(repoRoot), migration, "migration.sql"), "utf8");
  return [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]!);
}

/** Tables created by the Stage 4A migration (derived from its SQL; never hard-coded). */
export function stage4aTableNames(repoRoot: string): string[] {
  return migrationTableNames(repoRoot, STAGE_4A_MIGRATION);
}

/** Tables created by the Stage 4B migration (derived from its SQL; never hard-coded). */
export function stage4bTableNames(repoRoot: string): string[] {
  return migrationTableNames(repoRoot, STAGE_4B_MIGRATION);
}

/** Tables created by the Stage 4C migration (derived from its SQL; never hard-coded). */
export function stage4cTableNames(repoRoot: string): string[] {
  return migrationTableNames(repoRoot, STAGE_4C_MIGRATION);
}

/** Tables created by the Stage 4D migration (derived from its SQL; never hard-coded). */
export function stage4dTableNames(repoRoot: string): string[] {
  return migrationTableNames(repoRoot, STAGE_4D_MIGRATION);
}

/** Stage 4A can only be reversed after Stage 4B has been reversed (4B tables reference 4A tables). */
export async function governedRollbackStage4A(opts: RollbackOptions): Promise<RollbackResult> {
  const applied = appliedMigrationNames(path.resolve(opts.databaseFile));
  if (applied?.includes(STAGE_4B_MIGRATION)) {
    return { ok: false, reason: "Stage 4B is applied; roll Stage 4B back first (rollback-4b), then Stage 4A." };
  }
  return rollbackStage(opts, STAGE_4A_MIGRATION, "4a", (t) => t !== "dpos_migration_records");
}

export async function governedRollbackStage4B(opts: RollbackOptions): Promise<RollbackResult> {
  const applied = appliedMigrationNames(path.resolve(opts.databaseFile));
  if (applied?.includes(STAGE_4C_MIGRATION)) {
    return { ok: false, reason: "Stage 4C is applied; roll Stage 4C back first (rollback-4c), then Stage 4B." };
  }
  return rollbackStage(opts, STAGE_4B_MIGRATION, "4b", () => true);
}

/** Stage 4C (scoring and ranking) tables only. V1.5, Stage 4A and Stage 4B tables are untouched. Refused while 4D is applied. */
export async function governedRollbackStage4C(opts: RollbackOptions): Promise<RollbackResult> {
  const applied = appliedMigrationNames(path.resolve(opts.databaseFile));
  if (applied?.includes(STAGE_4D_MIGRATION)) {
    return { ok: false, reason: "Stage 4D is applied; roll Stage 4D back first (rollback-4d), then Stage 4C." };
  }
  return rollbackStage(opts, STAGE_4C_MIGRATION, "4c", () => true);
}

/** Stage 4D (health score, health evidence and board review) tables only. Everything earlier is untouched. */
export async function governedRollbackStage4D(opts: RollbackOptions): Promise<RollbackResult> {
  return rollbackStage(opts, STAGE_4D_MIGRATION, "4d", () => true);
}

async function rollbackStage(opts: RollbackOptions, migration: string, label: string, countTable: (table: string) => boolean): Promise<RollbackResult> {
  const now = (opts.now ?? (() => new Date()))();
  const repoRoot = path.resolve(opts.repoRoot);
  const databaseFile = path.resolve(opts.databaseFile);
  const backupDir = opts.backupDir ?? path.join(path.dirname(databaseFile), "backups");
  const applied = appliedMigrationNames(databaseFile);
  if (!applied || !applied.includes(migration)) {
    return { ok: false, reason: `Stage ${label.toUpperCase()} migration is not applied to this database.` };
  }
  const newTables = migrationTableNames(repoRoot, migration).filter(countTable);
  const ro = openReadOnly(databaseFile);
  const counts: Record<string, number> = {};
  try {
    for (const t of newTables) {
      counts[t] = (ro.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c;
    }
  } finally {
    ro.close();
  }
  const nonEmpty = Object.fromEntries(Object.entries(counts).filter(([, c]) => c > 0));
  if (Object.keys(nonEmpty).length && !opts.allowDataLoss) {
    return {
      ok: false,
      reason: "Integration tables contain data; rollback would discard it. Re-run with allowDataLoss after reviewing the backup.",
      discardedRows: nonEmpty,
    };
  }
  const legacyTables = legacyTableNames(repoRoot);
  const backupFile = backup(databaseFile, backupDir, `pre-rollback-${label}`, now);
  const before = combineFingerprint(legacyFingerprint(databaseFile, legacyTables));
  const down = fs.readFileSync(path.join(migrationsDir(repoRoot), migration, "down.sql"), "utf8");
  const db = new DatabaseSync(databaseFile);
  try {
    db.exec("BEGIN");
    db.exec(down);
    db.prepare(`DELETE FROM _prisma_migrations WHERE migration_name = ?`).run(migration);
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    db.close();
    restoreBackup(backupFile, databaseFile);
    return { ok: false, reason: `down.sql failed: ${(e as Error).message}`, backupFile };
  }
  db.close();
  const after = combineFingerprint(legacyFingerprint(databaseFile, legacyTables));
  if (before !== after) {
    restoreBackup(backupFile, databaseFile);
    return { ok: false, reason: "V1.5 fingerprint changed during rollback; database restored.", backupFile, legacyPreserved: false };
  }
  return { ok: true, backupFile, discardedRows: nonEmpty, legacyPreserved: true };
}
