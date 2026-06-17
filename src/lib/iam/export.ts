import { prisma } from "@/lib/db";
import { recommendPlaybook } from "./playbooks";
import { shortDate } from "@/lib/format";

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: string[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
}

export async function buildManagementExportCsv(iamRunId: string): Promise<string> {
  const run = await prisma.iamRun.findUnique({
    where: { id: iamRunId },
    include: {
      company: true,
      actions: { orderBy: { priorityScore: "desc" } },
      dataGaps: { where: { status: "open" } },
    },
  });
  if (!run) throw new Error("Run not found");

  const headers = [
    "priority_rank",
    "action_title",
    "action_type",
    "why_it_matters",
    "recommended_playbook",
    "owner",
    "due_date",
    "confidence",
    "current_status",
    "limitation",
  ];

  const rows = run.actions
    .filter((a) => a.featuredSlot != null || a.managementPriorityFlag)
    .map((a) => {
      let detail: Record<string, unknown> = {};
      try {
        detail = a.detailJson ? JSON.parse(a.detailJson) : {};
      } catch {
        detail = {};
      }
      const pb = recommendPlaybook({
        actionType: a.actionType,
        detail,
        serviceOperationalRisk: Boolean(detail.serviceRisk),
      });
      return [
        a.featuredSlot != null ? String(a.featuredSlot) : "mgmt",
        a.actionTitle,
        a.actionType,
        String(detail.reason ?? "Inventory action requires management review"),
        pb.playbookName,
        a.ownerName ?? a.ownerRole ?? "",
        a.dueDate ? shortDate(a.dueDate) : "",
        a.confidenceLevel,
        a.workflowState,
        a.confidenceLevel.includes("Low") || a.confidenceLevel.includes("Insufficient")
          ? "Review cautiously"
          : "",
      ];
    });

  return toCsv(headers, rows);
}

export async function buildActionTrackerCsv(iamRunId: string): Promise<string> {
  const actions = await prisma.action.findMany({
    where: {
      iamRunId,
      workflowState: { in: ["Approved", "Awaiting Acceptance", "Active", "Holdover", "Paused"] },
    },
    orderBy: { dueDate: "asc" },
  });

  const headers = [
    "action_id",
    "action_title",
    "owner",
    "due_date",
    "review_date",
    "workflow_state",
    "visibility_class",
  ];

  const rows = actions.map((a) => [
    a.id,
    a.actionTitle,
    a.ownerName ?? a.ownerRole ?? "",
    a.dueDate ? shortDate(a.dueDate) : "",
    a.reviewDate ? shortDate(a.reviewDate) : "",
    a.workflowState,
    a.visibilityClass,
  ]);

  return toCsv(headers, rows);
}

export async function buildArchiveExportCsv(iamRunId: string): Promise<string> {
  const archives = await prisma.actionHistoryArchive.findMany({
    where: { iamRunId },
    orderBy: { archivedDate: "desc" },
  });

  const completed = await prisma.action.findMany({
    where: { iamRunId, workflowState: "Completed" },
    orderBy: { completedDate: "desc" },
  });

  const headers = [
    "action_id",
    "action_title",
    "action_type",
    "owner",
    "first_surfaced_date",
    "completed_date",
    "archived_date",
    "original_estimated_impact",
    "actual_achieved_impact",
  ];

  const archiveRows = archives.map((a) => [
    a.actionId,
    a.actionTitle,
    a.actionType,
    a.ownerRoleOrUser ?? "",
    shortDate(a.firstSurfacedDate),
    a.completedDate ? shortDate(a.completedDate) : "",
    shortDate(a.archivedDate),
    a.originalEstimatedImpact != null ? String(a.originalEstimatedImpact) : "",
    a.actualAchievedImpact != null ? String(a.actualAchievedImpact) : "",
  ]);

  const completedRows = completed.map((a) => [
    a.id,
    a.actionTitle,
    a.actionType,
    a.ownerName ?? a.ownerRole ?? "",
    a.firstSurfacedDate ? shortDate(a.firstSurfacedDate) : "",
    a.completedDate ? shortDate(a.completedDate) : "",
    "",
    a.originalEstimatedImpact != null ? String(a.originalEstimatedImpact) : "",
    a.actualAchievedImpact != null ? String(a.actualAchievedImpact) : "",
  ]);

  return toCsv(headers, [...completedRows, ...archiveRows]);
}

export function managementExportFilename(companyName: string, reviewDate: Date): string {
  const d = reviewDate.toISOString().slice(0, 10).replace(/-/g, "");
  const safe = companyName.replace(/[^a-zA-Z0-9]/g, "_");
  return `IAM_Management_${safe}_${d}_Summary_v1.csv`;
}
