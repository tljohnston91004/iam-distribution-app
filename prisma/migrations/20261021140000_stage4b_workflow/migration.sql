-- Stage 4B: IAM candidate / management-decision / ownership / active-action workflow.
-- ADDITIVE ONLY: creates new tables/indexes/triggers. No V1.5 table and no Stage 4A table or column is altered,
-- dropped or repurposed. Generated with `prisma migrate diff` from the Stage 4A schema (4c67a54) to the Stage 4B
-- schema, plus the governance section at the end. Reverse with down.sql via scripts/iam-migrate.ts rollback-4b
-- (backup first; refuses to discard workflow data unless explicitly told to).
-- CreateTable
CREATE TABLE "iam_core_workflow_states" (
    "candidate_id" TEXT NOT NULL PRIMARY KEY,
    "dpos_company_id" TEXT NOT NULL,
    "workflow_state" TEXT NOT NULL,
    "grouped_condition_key" TEXT NOT NULL,
    "title" TEXT,
    "category" TEXT,
    "candidate_type" TEXT,
    "presented_at" DATETIME,
    "presentation_count" INTEGER NOT NULL DEFAULT 0,
    "re_review_required" BOOLEAN NOT NULL DEFAULT false,
    "re_review_reason" TEXT,
    "re_review_raised_at" DATETIME,
    "prior_qualified_rejections" INTEGER NOT NULL DEFAULT 0,
    "repeated_rejection_flag" BOOLEAN NOT NULL DEFAULT false,
    "senior_review_required" BOOLEAN NOT NULL DEFAULT false,
    "escalated_to" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "iam_core_workflow_states_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_workflow_history" (
    "history_id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "reason" TEXT,
    "detail_json" TEXT,
    "at" DATETIME NOT NULL,
    CONSTRAINT "iam_core_workflow_history_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_management_decisions" (
    "decision_id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "grouped_condition_key" TEXT NOT NULL,
    "decision_type" TEXT NOT NULL,
    "reason" TEXT,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "decided_at" DATETIME NOT NULL,
    "system_recommendation_id" TEXT,
    "recommendation_version" INTEGER,
    "plan_id" TEXT,
    "plan_version" INTEGER,
    "qualified_rejection" BOOLEAN NOT NULL DEFAULT false,
    "rejection_ordinal" INTEGER,
    "repeated_rejection_flagged" BOOLEAN NOT NULL DEFAULT false,
    "detail_json" TEXT,
    CONSTRAINT "iam_core_management_decisions_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_suppressions" (
    "suppression_id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "started_at" DATETIME NOT NULL,
    "max_cycles" INTEGER NOT NULL,
    "cycles" INTEGER NOT NULL,
    "review_due_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "ended_at" DATETIME,
    "ended_by" TEXT,
    "end_trigger" TEXT,
    "end_reason" TEXT,
    CONSTRAINT "iam_core_suppressions_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_candidate_evidence" (
    "evidence_id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "evidence_ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sku" TEXT,
    "vendor" TEXT,
    "category" TEXT,
    "po_ref" TEXT,
    "backorder_ref" TEXT,
    "source_run_id" TEXT,
    "detail_json" TEXT,
    "attached_at" DATETIME NOT NULL,
    "attached_by" TEXT NOT NULL,
    CONSTRAINT "iam_core_candidate_evidence_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_assignment_events" (
    "assignment_event_id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "from_department" TEXT,
    "to_department" TEXT,
    "from_owner_id" TEXT,
    "to_owner_id" TEXT,
    "to_owner_name" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "on_behalf" BOOLEAN NOT NULL DEFAULT false,
    "plan_version_before" INTEGER,
    "plan_version_after" INTEGER,
    "at" DATETIME NOT NULL,
    CONSTRAINT "iam_core_assignment_events_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_action_tracking" (
    "candidate_id" TEXT NOT NULL PRIMARY KEY,
    "dpos_company_id" TEXT NOT NULL,
    "action_status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "status_reasons_json" TEXT,
    "status_evaluated_at" DATETIME,
    "target_start" DATETIME,
    "target_resolution" DATETIME,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "action_completion_pct" REAL,
    "condition_reduction_pct" REAL,
    "condition_reduction_status" TEXT NOT NULL DEFAULT 'NOT_YET_MEASURED',
    "baseline_exposure" REAL,
    "current_exposure" REAL,
    "exposure_unit" TEXT,
    "resolution_status" TEXT NOT NULL DEFAULT 'NOT_YET_MEASURED',
    "next_milestone" TEXT,
    "next_milestone_due" DATETIME,
    "latest_owner_update_at" DATETIME,
    "latest_owner_update_by" TEXT,
    "latest_owner_update_note" TEXT,
    "last_progress_event_pct" REAL,
    "last_reduction_event_pct" REAL,
    "completion_requested_at" DATETIME,
    "completion_requested_by" TEXT,
    "completion_validated_at" DATETIME,
    "completion_validated_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "iam_core_action_tracking_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_progress_updates" (
    "update_id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "official" BOOLEAN NOT NULL DEFAULT false,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "prior_value_json" TEXT,
    "new_value_json" TEXT,
    "note" TEXT,
    "evidence_ref" TEXT,
    CONSTRAINT "iam_core_progress_updates_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_action_status_history" (
    "status_history_id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "reasons_json" TEXT,
    "actor_id" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "include_in_what_changed" BOOLEAN NOT NULL DEFAULT false,
    "decision_required_raised" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "iam_core_action_status_history_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_decision_required" (
    "flag_id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "detail" TEXT,
    "raised_at" DATETIME NOT NULL,
    "raised_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_at" DATETIME,
    "resolved_by" TEXT,
    "resolution" TEXT,
    "related_entity_id" TEXT,
    CONSTRAINT "iam_core_decision_required_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_pause_requests" (
    "pause_request_id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "requested_at" DATETIME NOT NULL,
    "requested_date" DATETIME NOT NULL,
    "reason" TEXT NOT NULL,
    "expected_duration_days" INTEGER,
    "reactivation_condition" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "decided_by" TEXT,
    "decided_at" DATETIME,
    "decision_reason" TEXT,
    "paused_at" DATETIME,
    "review_due_at" DATETIME,
    "reactivated_at" DATETIME,
    "reactivated_by" TEXT,
    "reactivation_note" TEXT,
    CONSTRAINT "iam_core_pause_requests_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_blockers" (
    "blocker_id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "dependency" TEXT,
    "material" BOOLEAN NOT NULL DEFAULT true,
    "raised_by" TEXT NOT NULL,
    "raised_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "cleared_by" TEXT,
    "cleared_at" DATETIME,
    "clear_note" TEXT,
    CONSTRAINT "iam_core_blockers_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_contributor_authorizations" (
    "authorization_id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "granted_by" TEXT NOT NULL,
    "granted_at" DATETIME NOT NULL,
    "reason" TEXT NOT NULL,
    "revoked_at" DATETIME,
    "revoked_by" TEXT,
    CONSTRAINT "iam_core_contributor_authorizations_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "iam_core_workflow_states_dpos_company_id_workflow_state_idx" ON "iam_core_workflow_states"("dpos_company_id", "workflow_state");

-- CreateIndex
CREATE INDEX "iam_core_workflow_states_dpos_company_id_grouped_condition_key_idx" ON "iam_core_workflow_states"("dpos_company_id", "grouped_condition_key");

-- CreateIndex
CREATE INDEX "iam_core_workflow_history_candidate_id_at_idx" ON "iam_core_workflow_history"("candidate_id", "at");

-- CreateIndex
CREATE INDEX "iam_core_management_decisions_candidate_id_decided_at_idx" ON "iam_core_management_decisions"("candidate_id", "decided_at");

-- CreateIndex
CREATE INDEX "iam_core_management_decisions_dpos_company_id_grouped_condition_key_decision_type_idx" ON "iam_core_management_decisions"("dpos_company_id", "grouped_condition_key", "decision_type");

-- CreateIndex
CREATE INDEX "iam_core_suppressions_candidate_id_status_idx" ON "iam_core_suppressions"("candidate_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "iam_core_candidate_evidence_candidate_id_evidence_ref_key" ON "iam_core_candidate_evidence"("candidate_id", "evidence_ref");

-- CreateIndex
CREATE INDEX "iam_core_assignment_events_candidate_id_at_idx" ON "iam_core_assignment_events"("candidate_id", "at");

-- CreateIndex
CREATE INDEX "iam_core_action_tracking_dpos_company_id_action_status_idx" ON "iam_core_action_tracking"("dpos_company_id", "action_status");

-- CreateIndex
CREATE INDEX "iam_core_progress_updates_candidate_id_at_idx" ON "iam_core_progress_updates"("candidate_id", "at");

-- CreateIndex
CREATE INDEX "iam_core_action_status_history_candidate_id_at_idx" ON "iam_core_action_status_history"("candidate_id", "at");

-- CreateIndex
CREATE INDEX "iam_core_decision_required_candidate_id_status_idx" ON "iam_core_decision_required"("candidate_id", "status");

-- CreateIndex
CREATE INDEX "iam_core_decision_required_dpos_company_id_status_idx" ON "iam_core_decision_required"("dpos_company_id", "status");

-- CreateIndex
CREATE INDEX "iam_core_pause_requests_candidate_id_status_idx" ON "iam_core_pause_requests"("candidate_id", "status");

-- CreateIndex
CREATE INDEX "iam_core_blockers_candidate_id_status_idx" ON "iam_core_blockers"("candidate_id", "status");

-- CreateIndex
CREATE INDEX "iam_core_contributor_authorizations_candidate_id_user_id_idx" ON "iam_core_contributor_authorizations"("candidate_id", "user_id");

-- ---------------------------------------------------------------------------------------------------------------------
-- Governance constraints that Prisma's schema language cannot express (SQLite triggers / partial indexes).
-- They enforce, in the database itself, the Stage 4B rules:
--   * ledgers (workflow history, management decisions, assignment events, progress updates, action-status history,
--     candidate evidence) are append-only: never updated, never deleted;
--   * nothing is written to, and no workflow row of, a CLOSED candidate may change (a closed candidate is never reopened;
--     the service writes every ledger row BEFORE it stamps closed_at);
--   * one OPEN decision-required flag per (candidate, reason); one ACTIVE suppression, one pending/approved pause,
--     one OPEN blocker and one live contributor authorization at a time;
--   * workflow-state and action-status vocabularies.
-- ---------------------------------------------------------------------------------------------------------------------

-- One-at-a-time partial unique indexes.
CREATE UNIQUE INDEX "iam_core_suppressions_one_active" ON "iam_core_suppressions"("candidate_id") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "iam_core_decision_required_one_open" ON "iam_core_decision_required"("candidate_id", "reason_code") WHERE "status" = 'OPEN';
CREATE UNIQUE INDEX "iam_core_pause_requests_one_live" ON "iam_core_pause_requests"("candidate_id") WHERE "status" IN ('REQUESTED', 'APPROVED');
CREATE UNIQUE INDEX "iam_core_blockers_one_open" ON "iam_core_blockers"("candidate_id") WHERE "status" = 'OPEN';
CREATE UNIQUE INDEX "iam_core_contributor_authorizations_one_live" ON "iam_core_contributor_authorizations"("candidate_id", "user_id") WHERE "revoked_at" IS NULL;

-- Vocabulary guards.
CREATE TRIGGER "iam_core_workflow_states_vocab_insert" BEFORE INSERT ON "iam_core_workflow_states"
WHEN NEW."workflow_state" NOT IN ('NEW_CANDIDATE', 'PRESENTED', 'APPROVED_ASSIGNED', 'PENDING_OWNER_ACCEPTANCE', 'ACTIVE_ACTION', 'COMPLETED_VALIDATED', 'COMPLETED_HISTORY', 'REJECTED', 'SUPPRESSED', 'ESCALATED', 'RISK_ACCEPTED')
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_WORKFLOW_STATE_VOCABULARY');
END;
CREATE TRIGGER "iam_core_workflow_states_vocab_update" BEFORE UPDATE ON "iam_core_workflow_states"
WHEN NEW."workflow_state" NOT IN ('NEW_CANDIDATE', 'PRESENTED', 'APPROVED_ASSIGNED', 'PENDING_OWNER_ACCEPTANCE', 'ACTIVE_ACTION', 'COMPLETED_VALIDATED', 'COMPLETED_HISTORY', 'REJECTED', 'SUPPRESSED', 'ESCALATED', 'RISK_ACCEPTED')
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_WORKFLOW_STATE_VOCABULARY');
END;
CREATE TRIGGER "iam_core_action_tracking_vocab_insert" BEFORE INSERT ON "iam_core_action_tracking"
WHEN NEW."action_status" NOT IN ('NOT_STARTED', 'ON_TRACK', 'ATTENTION', 'AT_RISK', 'OVERDUE', 'PAUSED', 'BLOCKED', 'COMPLETED')
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_ACTION_STATUS_VOCABULARY');
END;
CREATE TRIGGER "iam_core_action_tracking_vocab_update" BEFORE UPDATE ON "iam_core_action_tracking"
WHEN NEW."action_status" NOT IN ('NOT_STARTED', 'ON_TRACK', 'ATTENTION', 'AT_RISK', 'OVERDUE', 'PAUSED', 'BLOCKED', 'COMPLETED')
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_ACTION_STATUS_VOCABULARY');
END;

-- Append-only ledgers.
CREATE TRIGGER "iam_core_workflow_history_no_update" BEFORE UPDATE ON "iam_core_workflow_history" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_workflow_history_no_delete" BEFORE DELETE ON "iam_core_workflow_history" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_management_decisions_no_update" BEFORE UPDATE ON "iam_core_management_decisions" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_management_decisions_no_delete" BEFORE DELETE ON "iam_core_management_decisions" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_assignment_events_no_update" BEFORE UPDATE ON "iam_core_assignment_events" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_assignment_events_no_delete" BEFORE DELETE ON "iam_core_assignment_events" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_progress_updates_no_update" BEFORE UPDATE ON "iam_core_progress_updates" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_progress_updates_no_delete" BEFORE DELETE ON "iam_core_progress_updates" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_action_status_history_no_update" BEFORE UPDATE ON "iam_core_action_status_history" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_action_status_history_no_delete" BEFORE DELETE ON "iam_core_action_status_history" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_candidate_evidence_no_update" BEFORE UPDATE ON "iam_core_candidate_evidence" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_candidate_evidence_no_delete" BEFORE DELETE ON "iam_core_candidate_evidence" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;

-- Mutable workflow rows are never deleted.
CREATE TRIGGER "iam_core_workflow_states_no_delete" BEFORE DELETE ON "iam_core_workflow_states" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_WORKFLOW_NOT_DELETABLE'); END;
CREATE TRIGGER "iam_core_action_tracking_no_delete" BEFORE DELETE ON "iam_core_action_tracking" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_WORKFLOW_NOT_DELETABLE'); END;
CREATE TRIGGER "iam_core_suppressions_no_delete" BEFORE DELETE ON "iam_core_suppressions" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_WORKFLOW_NOT_DELETABLE'); END;
CREATE TRIGGER "iam_core_decision_required_no_delete" BEFORE DELETE ON "iam_core_decision_required" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_WORKFLOW_NOT_DELETABLE'); END;
CREATE TRIGGER "iam_core_pause_requests_no_delete" BEFORE DELETE ON "iam_core_pause_requests" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_WORKFLOW_NOT_DELETABLE'); END;
CREATE TRIGGER "iam_core_blockers_no_delete" BEFORE DELETE ON "iam_core_blockers" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_WORKFLOW_NOT_DELETABLE'); END;
CREATE TRIGGER "iam_core_contributor_authorizations_no_delete" BEFORE DELETE ON "iam_core_contributor_authorizations" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_WORKFLOW_NOT_DELETABLE'); END;

-- Closed candidates: nothing new may be attached and no mutable workflow row may change.
CREATE TRIGGER "iam_core_workflow_history_closed_no_insert" BEFORE INSERT ON "iam_core_workflow_history"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_management_decisions_closed_no_insert" BEFORE INSERT ON "iam_core_management_decisions"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_assignment_events_closed_no_insert" BEFORE INSERT ON "iam_core_assignment_events"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_progress_updates_closed_no_insert" BEFORE INSERT ON "iam_core_progress_updates"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_action_status_history_closed_no_insert" BEFORE INSERT ON "iam_core_action_status_history"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_candidate_evidence_closed_no_insert" BEFORE INSERT ON "iam_core_candidate_evidence"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_workflow_states_closed_no_update" BEFORE UPDATE ON "iam_core_workflow_states"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = OLD."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_action_tracking_closed_no_insert" BEFORE INSERT ON "iam_core_action_tracking"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_action_tracking_closed_no_update" BEFORE UPDATE ON "iam_core_action_tracking"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = OLD."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_suppressions_closed_no_insert" BEFORE INSERT ON "iam_core_suppressions"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_suppressions_closed_no_update" BEFORE UPDATE ON "iam_core_suppressions"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = OLD."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_decision_required_closed_no_insert" BEFORE INSERT ON "iam_core_decision_required"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_decision_required_closed_no_update" BEFORE UPDATE ON "iam_core_decision_required"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = OLD."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_pause_requests_closed_no_insert" BEFORE INSERT ON "iam_core_pause_requests"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_pause_requests_closed_no_update" BEFORE UPDATE ON "iam_core_pause_requests"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = OLD."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_blockers_closed_no_insert" BEFORE INSERT ON "iam_core_blockers"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_blockers_closed_no_update" BEFORE UPDATE ON "iam_core_blockers"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = OLD."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_contributor_authorizations_closed_no_insert" BEFORE INSERT ON "iam_core_contributor_authorizations"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_contributor_authorizations_closed_no_update" BEFORE UPDATE ON "iam_core_contributor_authorizations"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = OLD."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
