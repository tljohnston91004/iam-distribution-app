/**
 * Governed company configuration for the Health targets (4DR-C3). There is NO default business value: a target exists only after a
 * manager configures it, and it is stored as a versioned COMPANY_FACTS record (append-only history, audited). Clearing a target
 * records a new version without it, so Efficiency becomes "Unavailable - target not configured" again.
 *
 * An invalid target is refused with an explicit configuration error and is never stored or scored.
 */
import type { PrismaClient } from "@prisma/client";
import { DposError, type Db } from "../errors";
import { requireManagement, type WorkflowActor } from "../workflow/permissions";
import { turnsTargetState, type TurnsTargetState } from "./components";
import type { CompanyFactsEvidence } from "./evidence";
import { readHealthEvidence, recordHealthEvidence } from "./service";

type Ctx = { dposCompanyId: string; companyTimeZone?: string | null };

export interface TargetConfigRequest {
  /** A positive number sets the target; null clears it; undefined leaves it unchanged. */
  turnsTarget?: number | null;
  gmroiTarget?: number | null;
}

export interface TargetConfigState {
  turnsTarget: { state: TurnsTargetState; value: number | null; message: string };
  gmroiTarget: { state: "CONFIGURED" | "NOT_CONFIGURED"; value: number | null; message: string };
  evidenceVersion: number | null;
}

export async function readTargetConfig(db: Db, ctx: Ctx): Promise<TargetConfigState> {
  const ev = (await readHealthEvidence(db, ctx)).COMPANY_FACTS;
  const facts = (ev?.value ?? null) as CompanyFactsEvidence | null;
  const t = turnsTargetState(facts);
  return {
    turnsTarget: { state: t.state, value: t.state === "CONFIGURED" ? facts!.turnsTarget! : null, message: t.message },
    gmroiTarget: facts?.gmroiTarget !== undefined ? { state: "CONFIGURED", value: facts.gmroiTarget, message: "A governed GMROI target is configured (GMROI also needs a reliable governed input)." } : { state: "NOT_CONFIGURED", value: null, message: "Not Available / Not Configured: no governed GMROI target exists." },
    evidenceVersion: ev?.evidenceVersion ?? null,
  };
}

const bad = (v: unknown) => v !== undefined && v !== null && (typeof v !== "number" || !Number.isFinite(v) || v <= 0);

export async function configureTargets(db: PrismaClient, ctx: Ctx, actor: WorkflowActor, req: TargetConfigRequest, opts: { at?: Date } = {}): Promise<TargetConfigState> {
  requireManagement(actor, "Configuring Health targets");
  if (bad(req.turnsTarget)) throw new DposError("INVALID_TURNS_TARGET", "The inventory turns target must be a finite number greater than zero (or null to clear it). Nothing was stored.", 400);
  if (bad(req.gmroiTarget)) throw new DposError("INVALID_GMROI_TARGET", "The GMROI target must be a finite number greater than zero (or null to clear it). Nothing was stored.", 400);
  const current = ((await readHealthEvidence(db, ctx)).COMPANY_FACTS?.value ?? {}) as CompanyFactsEvidence;
  const next: CompanyFactsEvidence = { ...current };
  delete next.note;
  if (req.turnsTarget === null) delete next.turnsTarget;
  else if (req.turnsTarget !== undefined) next.turnsTarget = req.turnsTarget;
  if (req.gmroiTarget === null) delete next.gmroiTarget;
  else if (req.gmroiTarget !== undefined) next.gmroiTarget = req.gmroiTarget;
  if (!Object.keys(next).length) next.note = "TARGETS_CLEARED";
  await recordHealthEvidence(db, ctx, actor, "COMPANY_FACTS", next, { sourceRefs: [`company-config:health-targets:set-by:${actor.actorId}`], at: opts.at ?? new Date() });
  return readTargetConfig(db, ctx);
}