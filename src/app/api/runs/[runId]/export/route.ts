import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  buildActionTrackerCsv,
  buildArchiveExportCsv,
  buildManagementExportCsv,
  managementExportFilename,
} from "@/lib/iam/export";

export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    const type = new URL(req.url).searchParams.get("type") ?? "management";

    const run = await prisma.iamRun.findUnique({
      where: { id: runId },
      include: { company: true },
    });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    let csv: string;
    let filename: string;

    switch (type) {
      case "tracker":
        csv = await buildActionTrackerCsv(runId);
        filename = managementExportFilename(run.company.name, run.reviewDate).replace(
          "Management",
          "Tracker"
        );
        break;
      case "archive":
        csv = await buildArchiveExportCsv(runId);
        filename = managementExportFilename(run.company.name, run.reviewDate).replace(
          "Management",
          "Archive"
        );
        break;
      default:
        csv = await buildManagementExportCsv(runId);
        filename = managementExportFilename(run.company.name, run.reviewDate);
    }

    await prisma.changeLog.create({
      data: {
        iamRunId: runId,
        entityType: "Export",
        action: `export:${type}`,
        detail: filename,
      },
    });

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
