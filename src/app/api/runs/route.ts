import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const runs = await prisma.iamRun.findMany({
    orderBy: { createdAt: "desc" },
    include: { company: true, _count: { select: { actions: true } } },
  });
  return NextResponse.json({ runs });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const companyName = String(body.companyName ?? "").trim();
    const runName = String(body.runName ?? "Weekly Inventory Action Review").trim();
    const reviewWeekStart = new Date(body.reviewWeekStart ?? Date.now());
    const reviewWeekEnd = new Date(body.reviewWeekEnd ?? Date.now());

    if (!companyName) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }

    let company = await prisma.company.findFirst({ where: { name: companyName } });
    if (!company) {
      company = await prisma.company.create({ data: { name: companyName } });
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
