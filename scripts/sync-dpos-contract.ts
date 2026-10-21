/**
 * Keeps the vendored IAM_RESULTS_RETURN_V1 contract identical to the DPOS source of truth.
 *
 *   npx tsx scripts/sync-dpos-contract.ts --check [--dpos-root <path>]   (also honours DPOS_REPO_ROOT)
 *   npx tsx scripts/sync-dpos-contract.ts --write  --dpos-root <path>
 *
 * --check : vendored file must match the pin in CONTRACT-SOURCE.json; when a DPOS root is given it must also match the source file.
 * --write : copy the DPOS source verbatim and rewrite the pin (commit, git blob, sha256).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CONTRACT_DIR = path.resolve(__dirname, "..", "src", "lib", "dpos", "contract");
const VENDORED = path.join(CONTRACT_DIR, "iam-results-return.ts");
const PIN = path.join(CONTRACT_DIR, "CONTRACT-SOURCE.json");
const SOURCE_REL = ["packages", "shared", "src", "iam-results-return.ts"];

const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function checkContract(dposRoot?: string): { ok: boolean; problems: string[]; vendoredSha256: string } {
  const pin = JSON.parse(fs.readFileSync(PIN, "utf8")) as { source: { sha256: string } };
  const vendored = sha256(VENDORED);
  const problems: string[] = [];
  if (vendored !== pin.source.sha256) problems.push(`vendored contract sha256 ${vendored} differs from the pin ${pin.source.sha256}`);
  if (dposRoot) {
    const src = path.join(dposRoot, ...SOURCE_REL);
    if (!fs.existsSync(src)) problems.push(`DPOS source not found: ${src}`);
    else if (sha256(src) !== vendored) problems.push(`DPOS source ${src} (sha256 ${sha256(src)}) differs from the vendored copy`);
  }
  return { ok: problems.length === 0, problems, vendoredSha256: vendored };
}

function main() {
  const rootArg = process.argv.indexOf("--dpos-root");
  const dposRoot = (rootArg >= 0 ? process.argv[rootArg + 1] : undefined) ?? process.env.DPOS_REPO_ROOT;
  if (process.argv.includes("--write")) {
    if (!dposRoot) throw new Error("--write requires --dpos-root (or DPOS_REPO_ROOT)");
    const src = path.join(dposRoot, ...SOURCE_REL);
    fs.copyFileSync(src, VENDORED);
    const git = (...a: string[]) => execFileSync("git", ["-C", dposRoot, ...a], { encoding: "utf8" }).trim();
    const pin = JSON.parse(fs.readFileSync(PIN, "utf8"));
    pin.source.commit = git("log", "-1", "--format=%H", "--", SOURCE_REL.join("/"));
    pin.source.gitBlob = git("hash-object", SOURCE_REL.join("/"));
    pin.source.sha256 = sha256(VENDORED);
    fs.writeFileSync(PIN, JSON.stringify(pin, null, 2) + "\n");
    console.log(`synced from ${src}\n${JSON.stringify(pin.source, null, 2)}`);
    return;
  }
  const r = checkContract(dposRoot);
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}

if (require.main === module) main();
