/**
 * Shared helpers for the Stage 4A integration tests (node:test via tsx).
 * Every test database is a throw-away copy created by the governed migration; the real data/iam.db is never opened.
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bindCompany, type DposCompanyContext } from "../../src/lib/dpos/company-context";
import { loadDposIntegrationConfig, type DposIntegrationConfig } from "../../src/lib/dpos/config";
import { governedMigrate, sqliteUrl } from "../../src/lib/dpos/migrate/governed-migrate";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");

export const DEFAULT_COMPANY_ID = "6f1c2a52-8e3b-4a57-9b53-2f1f0c1d7a01";

export function envFor(over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    IAM_DEPLOYMENT_MODE: "DPOS_INTEGRATED",
    IAM_ENVIRONMENT_CLASS: "TEST",
    IAM_CONFIGURATION_ID: "cfg-test-1",
    IAM_DPOS_COMPANY_ID: DEFAULT_COMPANY_ID,
    IAM_DATA_HUB_COMPANY_ID: DEFAULT_COMPANY_ID,
    IAM_INSTALLATION_ID: "inst-test-1",
    IAM_COMPANY_TIME_ZONE: "America/Chicago",
    DATA_HUB_BASE_URL: "http://127.0.0.1:9",
    IAM_SERVICE_IDENTITY_ID: undefined,
    ...over,
  };
}

export function makeConfig(over: Record<string, string | undefined> = {}): DposIntegrationConfig {
  const r = loadDposIntegrationConfig(envFor(over));
  if (!r.ok) throw new Error(`test config invalid: ${JSON.stringify(r.issues)}`);
  if (r.config.mode !== "DPOS_INTEGRATED") throw new Error("test config is not integrated");
  return r.config;
}

let templateFile: string | null = null;
const cleanups: Array<() => void> = [];
process.on("exit", () => {
  for (const c of cleanups) {
    try {
      c();
    } catch {
      /* best effort */
    }
  }
});

async function template(): Promise<string> {
  if (templateFile) return templateFile;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iam4a-template-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "template.db");
  const r = await governedMigrate({ databaseFile: file, repoRoot: REPO_ROOT, backupDir: path.join(dir, "bk") });
  if (!r.ok) throw new Error(`template migration failed: ${JSON.stringify(r)}`);
  templateFile = file;
  return file;
}

export interface TestDb {
  prisma: PrismaClient;
  file: string;
  dir: string;
  close(): Promise<void>;
}

/** A fresh, fully migrated (V1.5 baseline + Stage 4A) SQLite database. */
export async function createTestDb(): Promise<TestDb> {
  const src = await template();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iam4a-db-"));
  const file = path.join(dir, "iam.db");
  fs.copyFileSync(src, file);
  const prisma = new PrismaClient({ datasources: { db: { url: sqliteUrl(file) } } });
  const close = async () => {
    await prisma.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { prisma, file, dir, close };
}

export async function boundContext(db: PrismaClient, config: DposIntegrationConfig): Promise<DposCompanyContext> {
  return bindCompany(db, config, { actor: "test-operator", createCompanyName: "Test Company" });
}

export const uuid = () => randomUUID();

/** Locate the DPOS repository (sibling worktree by default; override with DPOS_REPO_ROOT). */
export function findDposRoot(): string | null {
  // 4A-D3: no developer layout (and no junction) is encoded anywhere; the DPOS worktree is supplied explicitly.
  const candidates = [process.env.DPOS_REPO_ROOT].filter((p): p is string => !!p);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "packages", "deployment", "operator-front-door", "module-access.mjs"))) return c;
  }
  return null;
}

// ---- DPOS Stage 1B installation fixture (real module-access runtime, signed entitlements) --------------------------

export interface DposFixtureInstallation {
  base: string;
  root: string;
}

export async function loadDposFixtures(dposRoot: string): Promise<{ createModuleInstallation(o: Record<string, unknown>): DposFixtureInstallation }> {
  const { pathToFileURL } = await import("node:url");
  const file = path.join(dposRoot, "packages", "deployment", "operator-front-door", "tests", "module-installation-fixture.mjs");
  return (await import(pathToFileURL(file).href)) as never;
}

/** TEST-ONLY registry copy in which IAM has a live service and an attainable readiness path (never used outside tests). */
export function writeAttainableRegistry(dposRoot: string): { file: string; dir: string } {
  const registry = JSON.parse(fs.readFileSync(path.join(dposRoot, "release", "module-registry.json"), "utf8"));
  const iam = registry.modules.find((m: { moduleId: string }) => m.moduleId === "IAM");
  iam.service = { serviceId: "iam", kind: "DPOS_SERVICE" };
  iam.operationalService = true;
  iam.implementationReadiness.attainable = true;
  delete iam.implementationReadiness.notAttainableReason;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iam4a-registry-"));
  const file = path.join(dir, "module-registry.json");
  fs.writeFileSync(file, JSON.stringify(registry, null, 2));
  return { file, dir };
}