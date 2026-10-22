/**
 * Stage 4C test fixtures: scoring inputs built from approved FACTOR POINTS, tie-break items, and short-cuts that give a
 * candidate stored scoring inputs. Everything runs against throw-away governed-migrated databases (never data/iam.db).
 */
import type { PrismaClient } from "@prisma/client";
import type { ActionabilityLevel, ConfidenceLevel, SeverityLevel } from "../../src/lib/dpos/scoring/config";
import type { TieBreakValues } from "../../src/lib/dpos/scoring/calculate";
import type { RankItem } from "../../src/lib/dpos/scoring/ranking";
import { recordScoringInputs, type ScoringInputs } from "../../src/lib/dpos/scoring";
import { SYSTEM_ACTOR } from "../../src/lib/dpos/workflow";
import { T0, at, presentedCandidate, type Fixture } from "./workflow-helpers";

/** Percent of the denominator that lands exactly in each approved band (cash: of average weekly revenue). */
export const CASH_PCT: Record<number, number> = { 0: 0, 6: 1, 12: 3, 18: 7, 24: 15, 30: 30 };
export const PROFIT_PCT: Record<number, number> = { 0: 0, 3: 0.05, 6: 0.15, 9: 0.3, 12: 0.6, 15: 1 };
export const INVENTORY_PCT: Record<number, number> = { 0: 0, 3: 0.25, 6: 0.5, 9: 1, 12: 2, 15: 5 };
export const OP_LEVEL: Record<number, SeverityLevel> = { 0: "NONE", 3: "LOW", 6: "MODERATE", 9: "SIGNIFICANT", 12: "SEVERE", 15: "CRITICAL" };
export const CU_LEVEL: Record<number, SeverityLevel> = { 0: "NONE", 2: "LOW", 4: "MODERATE", 6: "SIGNIFICANT", 8: "SEVERE", 10: "CRITICAL" };
export const TIME_DAYS: Record<number, number> = { 0: 100, 2: 80, 4: 45, 6: 20, 8: 10, 10: 5 };
export const ACT_LEVEL: Record<number, ActionabilityLevel> = { 0: "UNCLEAR", 1: "DIFFICULT", 2: "LIMITED", 3: "MODERATE", 4: "STRONG", 5: "IMMEDIATE" };

export interface FactorPoints {
  cash: number;
  prof: number;
  inv: number;
  op: number;
  cu: number;
  time: number;
  act: number;
}

export const WEEKLY_REVENUE = 100_000;
export const GROSS_PROFIT = 1_000_000;
export const INVENTORY_TOTAL = 1_000_000;

let attributionSeq = 0;
/** A fresh, unique evidence identity (the same economic amount can only be attributed to one candidate). */
export const freshEvidenceRef = (label: string) => `ev-${label}-${++attributionSeq}`;

/** Scoring inputs whose seven factors earn EXACTLY the given points (raw core score = their sum). */
export function fromPoints(p: FactorPoints, over: Partial<ScoringInputs> = {}): ScoringInputs {
  const cash = (CASH_PCT[p.cash]! / 100) * WEEKLY_REVENUE;
  const prof = Math.round((PROFIT_PCT[p.prof]! / 100) * GROSS_PROFIT);
  const inv = Math.round((INVENTORY_PCT[p.inv]! / 100) * INVENTORY_TOTAL);
  const economicAttribution: ScoringInputs["economicAttribution"] = [
    ...(cash !== 0 ? [{ evidenceRef: freshEvidenceRef("cash"), impactType: "CASH_IMPACT" as const, scoringHome: "cash" as const, amount: cash }] : []),
    ...(prof !== 0 ? [{ evidenceRef: freshEvidenceRef("profit"), impactType: "PROFIT_IMPACT" as const, scoringHome: "profitability" as const, amount: prof }] : []),
    ...(inv !== 0 ? [{ evidenceRef: freshEvidenceRef("inv"), impactType: "INVENTORY_VALUE" as const, scoringHome: "inventoryExposure" as const, amount: inv }] : []),
  ];
  return {
    cash: { expected13WeekNetCashImpact: cash, averageWeeklyRevenue: WEEKLY_REVENUE },
    profitability: { netProfitabilityImpact: prof, trailing12MonthGrossProfit: GROSS_PROFIT },
    inventoryExposure: { affectedInventoryBookValue: inv, totalInventoryBookValue: INVENTORY_TOTAL },
    economicAttribution,
    operationalRisk: OP_LEVEL[p.op]!,
    customerRevenue: CU_LEVEL[p.cu]!,
    timeSensitivity: { daysToAction: TIME_DAYS[p.time]! },
    actionability: ACT_LEVEL[p.act]!,
    dataConfidence: "HIGH",
    ...over,
  };
}

export const ZERO: FactorPoints = { cash: 0, prof: 0, inv: 0, op: 0, cu: 0, time: 0, act: 0 };
/** 30+15+15+15+10+10+5 = 100 */
export const MAX: FactorPoints = { cash: 30, prof: 15, inv: 15, op: 15, cu: 10, time: 10, act: 5 };
/** 30+12+12+9+6+8+3 = 80 (High). No emergency trigger fires (Operational Risk < 12, Customer & Revenue < 8). */
export const P80: FactorPoints = { cash: 30, prof: 12, inv: 12, op: 9, cu: 6, time: 8, act: 3 };
/** 30+15+15+9+6+10+4 = 89 (Critical). No emergency trigger fires. */
export const P89: FactorPoints = { cash: 30, prof: 15, inv: 15, op: 9, cu: 6, time: 10, act: 4 };
/** 30+15+15+9+6+8+3 = 86 */
export const P86: FactorPoints = { cash: 30, prof: 15, inv: 15, op: 9, cu: 6, time: 8, act: 3 };
/** 12+6+6+6+4+4+3 = 41 (Watch) */
export const P41: FactorPoints = { cash: 12, prof: 6, inv: 6, op: 6, cu: 4, time: 4, act: 3 };

export const sum = (p: FactorPoints) => p.cash + p.prof + p.inv + p.op + p.cu + p.time + p.act;

/** A copy of a factor-point profile with some factors changed (used to make candidates differ in one thing). */
export const pts = (base: FactorPoints, over: Partial<FactorPoints>): FactorPoints => ({ ...base, ...over });

export function tieValues(over: Partial<TieBreakValues> = {}): TieBreakValues {
  return {
    cashScore: 12,
    expectedCash: 1000,
    timeScore: 6,
    operationalRisk: 9,
    customerRevenue: 6,
    preventableLoss: 500,
    confidenceRank: 3,
    benefitSpeed: 3,
    executionBurden: 0,
    persistence: 1,
    actionDeadline: "2026-12-01",
    ...over,
  };
}

export function rankItem(id: string, score: number, tie: Partial<TieBreakValues> = {}, over: Partial<RankItem> = {}): RankItem {
  return { candidateId: id, domainScore: score, effectiveScore: score, tie: tieValues(tie), createdAt: "2026-10-01T00:00:00.000Z", eligibleForTop2: true, ...over };
}

export const CONFIDENCES: ConfidenceLevel[] = ["HIGH", "MEDIUM", "LOW", "INSUFFICIENT"];

/** A presented candidate (own condition key) that already has stored scoring inputs. */
export async function scoredCandidate(f: Fixture, key: string, inputs: ScoringInputs, opts: { when?: Date } = {}): Promise<string> {
  const id = await presentedCandidate(f, { key });
  await recordScoringInputs(f.db, f.ctx, SYSTEM_ACTOR, id, inputs, { at: opts.when ?? at(0, 5) });
  return id;
}

export const resultFor = (db: PrismaClient, runId: string, candidateId: string) =>
  db.iamCoreScoreResult.findFirstOrThrow({ where: { scoringRunId: runId, candidateId } });

export { T0, at };
