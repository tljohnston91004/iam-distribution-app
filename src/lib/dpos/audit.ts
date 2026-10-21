import type { Db } from "./errors";

export interface AuditInput {
  category: string;
  action: string;
  outcome: "SUCCESS" | "DENIED" | "FAILURE";
  actor?: string | null;
  dposCompanyId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  detail?: Record<string, unknown> | null;
  at?: Date;
}

/** Append one row to the append-only audit trail. Never throws into the caller's business path unless asked to. */
export async function writeAudit(db: Db, input: AuditInput): Promise<void> {
  await db.dposAuditEvent.create({
    data: {
      at: input.at ?? new Date(),
      category: input.category,
      action: input.action,
      outcome: input.outcome,
      actor: input.actor ?? null,
      dposCompanyId: input.dposCompanyId ?? null,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      detailJson: input.detail ? JSON.stringify(input.detail) : null,
    },
  });
}

/** Best-effort audit for denial paths (a failure to audit must not turn a denial into an allow or a 500). */
export async function tryAudit(db: Db, input: AuditInput): Promise<void> {
  try {
    await writeAudit(db, input);
  } catch {
    /* denial remains a denial */
  }
}
