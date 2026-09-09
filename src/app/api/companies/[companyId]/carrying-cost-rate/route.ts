import { NextResponse } from "next/server";
import {
  CARRYING_COST_RATE_SOURCES,
  getCompanyCarryingCostRate,
  listCarryingCostRateHistory,
  percentToDecimal,
  setCompanyCarryingCostRate,
  type CarryingCostRateSource,
} from "@/lib/iam/company/carrying-cost-rate";

/**
 * GET /api/companies/[companyId]/carrying-cost-rate
 * POST — update Annual Inventory Carrying-Cost Rate (authorized roles only).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ companyId: string }> }) {
  try {
    const { companyId } = await ctx.params;
    const config = await getCompanyCarryingCostRate(companyId);
    const history = await listCarryingCostRateHistory(companyId);
    return NextResponse.json({ config, history, allowedSources: CARRYING_COST_RATE_SOURCES });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Load failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ companyId: string }> }) {
  try {
    const { companyId } = await ctx.params;
    const body = (await req.json()) as {
      /** Prefer percent for UI (24 = 24%). */
      ratePercent?: number;
      /** Or decimal (0.24). */
      annualCarryingCostRate?: number;
      source?: string;
      configurationNote?: string;
      effectiveDate?: string;
      performedBy?: string;
      iamRunId?: string;
    };

    let decimal: number | null = null;
    if (body.ratePercent != null && Number.isFinite(Number(body.ratePercent))) {
      decimal = percentToDecimal(Number(body.ratePercent));
    } else if (body.annualCarryingCostRate != null && Number.isFinite(Number(body.annualCarryingCostRate))) {
      decimal = Number(body.annualCarryingCostRate);
    }
    if (decimal == null) {
      return NextResponse.json(
        { error: "ratePercent (e.g. 24) or annualCarryingCostRate (e.g. 0.24) is required" },
        { status: 400 }
      );
    }
    if (!body.source || !CARRYING_COST_RATE_SOURCES.includes(body.source as CarryingCostRateSource)) {
      return NextResponse.json(
        { error: `source is required. Allowed: ${CARRYING_COST_RATE_SOURCES.join(", ")}` },
        { status: 400 }
      );
    }
    if (!body.performedBy?.trim()) {
      return NextResponse.json({ error: "performedBy is required" }, { status: 400 });
    }

    const config = await setCompanyCarryingCostRate({
      companyId,
      annualCarryingCostRate: decimal,
      source: body.source as CarryingCostRateSource,
      configurationNote: body.configurationNote,
      effectiveDate: body.effectiveDate,
      performedBy: body.performedBy,
      iamRunId: body.iamRunId,
    });
    const history = await listCarryingCostRateHistory(companyId);
    return NextResponse.json({ status: "ok", config, history });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Update failed";
    const status = message.includes("Permission denied") ? 403 : message.includes("cannot") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
