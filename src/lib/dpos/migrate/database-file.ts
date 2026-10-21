/** Helpers for locating the SQLite database file (scripts/tests only — uses node:sqlite). */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Resolve a Prisma sqlite URL (`file:...`). Relative paths are relative to the `prisma/` directory, as Prisma does. */
export function databaseFileFromUrl(url: string | undefined, repoRoot: string): string | null {
  if (!url || !url.startsWith("file:")) return null;
  const p = url.slice("file:".length).split("?")[0]!;
  if (!p) return null;
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(repoRoot, "prisma", p);
}

export function appliedMigrations(file: string): string[] | null {
  if (!fs.existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const has = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'`).get();
    if (!has) return null;
    return (db.prepare(`SELECT migration_name AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`).all() as Array<{ n: string }>).map((r) => r.n);
  } finally {
    db.close();
  }
}
