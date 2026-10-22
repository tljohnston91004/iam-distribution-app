/**
 * Governed IAM database migration CLI (DPOS Stage 4A).
 *
 *   npx tsx scripts/iam-migrate.ts status
 *   npx tsx scripts/iam-migrate.ts apply --yes [--dry-run] [--backup-dir <dir>]
 *   npx tsx scripts/iam-migrate.ts rollback-4c --yes [--allow-data-loss] [--backup-dir <dir>]   (Stage 4C scoring tables only)
 *   npx tsx scripts/iam-migrate.ts rollback-4b --yes [--allow-data-loss] [--backup-dir <dir>]   (Stage 4B workflow tables only; refused while 4C is applied)
 *   npx tsx scripts/iam-migrate.ts rollback-4a --yes [--allow-data-loss] [--backup-dir <dir>]   (refused while 4B is applied)
 *
 * The database is taken from DATABASE_URL (or --database <file>). `apply` and `rollback-4a` change nothing without
 * --yes. Apply always takes a verified backup first, proves the V1.5 data is unchanged, and restores the backup
 * automatically if it is not. See docs/dpos-integration/README.md.
 */
import fs from "node:fs";
import path from "node:path";
import {
  STAGE_4A_MIGRATION,
  STAGE_4B_MIGRATION,
  STAGE_4C_MIGRATION,
  governedMigrate,
  governedRollbackStage4A,
  governedRollbackStage4B,
  governedRollbackStage4C,
  legacyTableNames,
  listMigrationNames,
  listUserTables,
} from "../src/lib/dpos/migrate/governed-migrate";
import { appliedMigrations, databaseFileFromUrl } from "../src/lib/dpos/migrate/database-file";

const REPO = path.resolve(__dirname, "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);

function loadEnv() {
  const envFile = path.join(REPO, ".env");
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") {
    const before = { ...process.env };
    process.loadEnvFile(envFile);
    for (const k of Object.keys(before)) process.env[k] = before[k]; // real environment wins over .env
  }
}

async function main() {
  loadEnv();
  const cmd = process.argv[2];
  const databaseFile = arg("--database") ?? databaseFileFromUrl(process.env.DATABASE_URL, REPO);
  if (!databaseFile) {
    console.error("No database: set DATABASE_URL or pass --database <file>.");
    process.exit(2);
  }
  const backupDir = arg("--backup-dir");
  if (cmd === "status") {
    const known = listMigrationNames(REPO);
    const tables = listUserTables(databaseFile);
    const applied = appliedMigrations(databaseFile);
    console.log(JSON.stringify({
      databaseFile,
      exists: fs.existsSync(databaseFile),
      tableCount: tables.length,
      v15TablesPresent: legacyTableNames(REPO).filter((t) => tables.includes(t)).length,
      v15TablesExpected: legacyTableNames(REPO).length,
      migrationHistory: applied === null ? "NONE (created by prisma db push — will be adopted after a structural proof)" : applied,
      knownMigrations: known,
      pending: known.filter((m) => !(applied ?? []).includes(m)),
      stage4aApplied: (applied ?? []).includes(STAGE_4A_MIGRATION),
      stage4bApplied: (applied ?? []).includes(STAGE_4B_MIGRATION),
      stage4cApplied: (applied ?? []).includes(STAGE_4C_MIGRATION),
    }, null, 2));
    return;
  }
  if (cmd === "apply") {
    const dryRun = flag("--dry-run") || !flag("--yes");
    if (!flag("--yes")) console.log("(no --yes: reporting only; nothing will be changed)");
    const r = await governedMigrate({ databaseFile, repoRoot: REPO, backupDir, dryRun });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  if (cmd === "rollback-4a") {
    if (!flag("--yes")) {
      console.log("Rollback removes ONLY the Stage 4A tables (V1.5 tables untouched). Re-run with --yes to proceed.");
      process.exit(2);
    }
    const r = await governedRollbackStage4A({ databaseFile, repoRoot: REPO, backupDir, allowDataLoss: flag("--allow-data-loss") });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  if (cmd === "rollback-4c") {
    if (!flag("--yes")) {
      console.log("Rollback removes ONLY the Stage 4C scoring tables (V1.5, Stage 4A and Stage 4B tables untouched). Re-run with --yes to proceed.");
      process.exit(2);
    }
    const r = await governedRollbackStage4C({ databaseFile, repoRoot: REPO, backupDir, allowDataLoss: flag("--allow-data-loss") });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  if (cmd === "rollback-4b") {
    if (!flag("--yes")) {
      console.log("Rollback removes ONLY the Stage 4B workflow tables (V1.5 and Stage 4A tables untouched). Re-run with --yes to proceed.");
      process.exit(2);
    }
    const r = await governedRollbackStage4B({ databaseFile, repoRoot: REPO, backupDir, allowDataLoss: flag("--allow-data-loss") });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  console.error("Usage: iam-migrate.ts status | apply --yes [--dry-run] | rollback-4c --yes [--allow-data-loss] | rollback-4b --yes [--allow-data-loss] | rollback-4a --yes [--allow-data-loss] (4b first)");
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
