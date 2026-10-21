import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { boundIamCompanyId } from "@/lib/dpos/runtime";
import { withDposAccess } from "@/lib/dpos/with-access";

async function GET_v15(_req: Request) {
  // DPOS_INTEGRATED: only the bound company's review cycles; STANDALONE_LEGACY: unchanged (all).
  const boundCompanyId = await boundIamCompanyId();
  const runs = await prisma.iamRun.findMany({
    ...(boundCompanyId ? { where: { companyId: boundCompanyId } } : {}),
    orderBy: { createdAt: "desc" },
    include: { company: true, _count: { select: { actions: true } } },
  });
  return NextResponse.json({ runs });
}

async function POST_v15(req: Request) {
  try {
    const body = await req.json();
    const companyName = String(body.companyName ?? "").trim();
    const runName = String(body.runName ?? "Weekly Inventory Action Review").trim();
    const reviewWeekStart = new Date(body.reviewWeekStart ?? Date.now());
    const reviewWeekEnd = new Date(body.reviewWeekEnd ?? Date.now());

    // DPOS_INTEGRATED: the review cycle belongs to the one governed company. A different company name is rejected;
    // no company is ever created from a request.
    const boundCompanyId = await boundIamCompanyId();
    let company;
    if (boundCompanyId) {
      company = await prisma.company.findUnique({ where: { id: boundCompanyId } });
      if (!company) {
        return NextResponse.json({ error: "The bound company record is missing" }, { status: 503 });
      }
      if (companyName && companyName.toLowerCase() !== company.name.toLowerCase()) {
        return NextResponse.json({ error: "COMPANY_MISMATCH: this installation serves a different company" }, { status: 409 });
      }
    } else {
      if (!companyName) {
        return NextResponse.json({ error: "Company name is required" }, { status: 400 });
      }

      company = await prisma.company.findFirst({ where: { name: companyName } });
      if (!company) {
        company = await prisma.company.create({ data: { name: companyName } });
      }
    }

    const run = await prisma.iamRun.create({
      data: {
        companyId: company.id,
        runName,
        reviewDate: reviewWeekStart,
        reviewWeekStart,
        reviewWeekEnd,
        reviewCadence: "weekly",
      },
    });

    await prisma.changeLog.create({
      data: {
        iamRunId: run.id,
        entityType: "IamRun",
        entityId: run.id,
        action: "created",
        detail: `Run "${runName}" created for ${companyName}`,
      },
    });

    return NextResponse.json({ runId: run.id });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create run" }, { status: 500 });
  }
}

export const GET = withDposAccess(GET_v15);
export const POST = withDposAccess(POST_v15);
