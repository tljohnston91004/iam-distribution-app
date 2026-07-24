import { NextResponse } from "next/server";
import { setCompanyOec } from "@/lib/iam/presentation/oec";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params;
  try {
    const body = await req.json();
    const oec = Number(body.organizationalExecutionCapability);
    if (!Number.isFinite(oec) || oec < 1) {
      return NextResponse.json({ error: "organizationalExecutionCapability must be >= 1" }, { status: 400 });
    }
    const result = await setCompanyOec({
      companyId,
      organizationalExecutionCapability: oec,
      recommendationAgingDays: body.recommendationAgingDays,
      performedBy: body.performedBy ?? "executive-user",
      iamRunId: body.iamRunId,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "OEC update failed" },
      { status: 500 }
    );
  }
}
