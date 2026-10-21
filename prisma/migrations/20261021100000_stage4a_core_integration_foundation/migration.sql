-- Stage 4A: DPOS-integrated IAM core integration foundation.
-- ADDITIVE ONLY: creates new tables/indexes/triggers. No V1.5 table is altered, dropped or repurposed.
-- Generated with `prisma migrate diff` from the V1.5 schema (b48e212) to the Stage 4A schema, plus the governance
-- section at the end. Reverse with down.sql via scripts/iam-migrate.ts (backup first).

-- CreateTable
CREATE TABLE "dpos_company_bindings" (
    "binding_id" TEXT NOT NULL PRIMARY KEY,
    "iam_company_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "data_hub_company_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "company_time_zone" TEXT,
    "environment_class" TEXT NOT NULL,
    "configuration_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "dpos_service_identities" (
    "service_identity_id" TEXT NOT NULL PRIMARY KEY,
    "identity_id" TEXT NOT NULL,
    "principal_kind" TEXT NOT NULL DEFAULT 'SERVICE',
    "module_id" TEXT NOT NULL DEFAULT 'IAM',
    "dpos_company_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "environment_class" TEXT NOT NULL,
    "capabilities_json" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "issuance_kind" TEXT NOT NULL,
    "credential_ref" TEXT,
    "issued_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" TEXT NOT NULL,
    "expires_at" DATETIME,
    "revoked_at" DATETIME,
    "revoked_by" TEXT,
    "revoked_reason" TEXT
);

-- CreateTable
CREATE TABLE "dpos_audit_events" (
    "audit_event_id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "actor" TEXT,
    "dpos_company_id" TEXT,
    "subject_type" TEXT,
    "subject_id" TEXT,
    "detail_json" TEXT
);

-- CreateTable
CREATE TABLE "dpos_refresh_attempts" (
    "refresh_attempt_id" TEXT NOT NULL PRIMARY KEY,
    "dpos_company_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "scheduled_for" TEXT,
    "catch_up" BOOLEAN NOT NULL DEFAULT false,
    "started_at" DATETIME NOT NULL,
    "completed_at" DATETIME,
    "status" TEXT NOT NULL,
    "failure_category" TEXT,
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "data_current_through" DATETIME,
    "operating_period_start" TEXT,
    "operating_period_end" TEXT,
    "input_summary_json" TEXT,
    "hub_correlation_id" TEXT
);

-- CreateTable
CREATE TABLE "dpos_refresh_state" (
    "dpos_company_id" TEXT NOT NULL PRIMARY KEY,
    "last_attempt_at" DATETIME,
    "last_attempt_status" TEXT,
    "last_success_at" DATETIME,
    "last_iam_refresh_at" DATETIME,
    "data_current_through" DATETIME,
    "next_scheduled_refresh_at" DATETIME,
    "schedule_status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "schedule_reason" TEXT,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "dpos_results_return_outbox" (
    "outbox_id" TEXT NOT NULL PRIMARY KEY,
    "producer_event_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "action_ref" TEXT,
    "event_type" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "contract_version" TEXT NOT NULL,
    "operation_key" TEXT,
    "payload_json" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" DATETIME,
    "next_attempt_at" DATETIME,
    "sync_status" TEXT NOT NULL DEFAULT 'PENDING',
    "failure_category" TEXT,
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "failure_issues_json" TEXT,
    "retry_eligible" BOOLEAN NOT NULL DEFAULT true,
    "manual_correction_required" BOOLEAN NOT NULL DEFAULT false,
    "admin_alert_raised" BOOLEAN NOT NULL DEFAULT false,
    "accepted_at" DATETIME,
    "acknowledgement_id" TEXT,
    "acknowledgement_json" TEXT,
    "lease_until" DATETIME
);

-- CreateTable
CREATE TABLE "dpos_results_return_outbox_attempts" (
    "attempt_id" TEXT NOT NULL PRIMARY KEY,
    "outbox_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "http_status" INTEGER,
    "outcome" TEXT NOT NULL,
    "failure_category" TEXT,
    "failure_code" TEXT,
    "acknowledgement_json" TEXT,
    "duration_ms" INTEGER,
    "payload_hash" TEXT,
    "detail_json" TEXT,
    CONSTRAINT "dpos_results_return_outbox_attempts_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "dpos_results_return_outbox" ("outbox_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "dpos_migration_records" (
    "migration_record_id" TEXT NOT NULL PRIMARY KEY,
    "migration_name" TEXT NOT NULL,
    "started_at" DATETIME NOT NULL,
    "completed_at" DATETIME NOT NULL,
    "outcome" TEXT NOT NULL,
    "backup_file" TEXT,
    "legacy_digest_before" TEXT,
    "legacy_digest_after" TEXT,
    "legacy_table_count" INTEGER,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "iam_core_candidates" (
    "candidate_id" TEXT NOT NULL PRIMARY KEY,
    "dpos_company_id" TEXT NOT NULL,
    "grouped_condition_key" TEXT NOT NULL,
    "grouped_condition_json" TEXT,
    "source_run_id" TEXT,
    "source_refresh_attempt_id" TEXT,
    "source_evidence_refs_json" TEXT,
    "lifecycle_state" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "recurrence_of_candidate_id" TEXT,
    "original_created_at" DATETIME NOT NULL,
    "closed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "iam_core_candidates_recurrence_of_candidate_id_fkey" FOREIGN KEY ("recurrence_of_candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_system_recommendations" (
    "recommendation_id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "recommendation_version" INTEGER NOT NULL,
    "recommended_at" DATETIME NOT NULL,
    "recommended_action_direction" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "supporting_evidence_refs_json" TEXT,
    "domain_score" REAL,
    "domain_rank" INTEGER,
    "recommendation_json" TEXT,
    "recommended_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "iam_core_system_recommendations_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_management_plans" (
    "plan_id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "plan_version" INTEGER NOT NULL,
    "based_on_recommendation_id" TEXT NOT NULL,
    "approval_state" TEXT NOT NULL DEFAULT 'PROPOSED',
    "management_decision" TEXT,
    "deviates_from_recommendation" BOOLEAN NOT NULL DEFAULT false,
    "deviation_reason" TEXT,
    "approver" TEXT,
    "approved_at" DATETIME,
    "plan_summary" TEXT,
    "plan_json" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "iam_core_management_plans_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "iam_core_management_plans_based_on_recommendation_id_fkey" FOREIGN KEY ("based_on_recommendation_id") REFERENCES "iam_core_system_recommendations" ("recommendation_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_ownerships" (
    "ownership_id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "responsible_department" TEXT NOT NULL,
    "task_owner_id" TEXT,
    "task_owner_name" TEXT,
    "assigned_at" DATETIME NOT NULL,
    "assigned_by" TEXT NOT NULL,
    "ended_at" DATETIME,
    CONSTRAINT "iam_core_ownerships_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_contributors" (
    "contributor_id" TEXT NOT NULL PRIMARY KEY,
    "ownership_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "iam_core_contributors_ownership_id_fkey" FOREIGN KEY ("ownership_id") REFERENCES "iam_core_ownerships" ("ownership_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_execution_states" (
    "candidate_id" TEXT NOT NULL PRIMARY KEY,
    "action_status" TEXT,
    "action_completion_pct" REAL,
    "condition_reduction_pct" REAL,
    "remaining_exposure" REAL,
    "remaining_exposure_unit" TEXT,
    "target_start" DATETIME,
    "target_resolution" DATETIME,
    "blockers_json" TEXT,
    "updated_by" TEXT,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "iam_core_execution_states_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_outcomes" (
    "candidate_id" TEXT NOT NULL PRIMARY KEY,
    "final_resolution_state" TEXT,
    "measured_result_json" TEXT,
    "attribution_json" TEXT,
    "attribution_confidence" TEXT,
    "residual_exposure" REAL,
    "closeout_at" DATETIME,
    "lessons_ref" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "iam_core_outcomes_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "dpos_company_bindings_iam_company_id_key" ON "dpos_company_bindings"("iam_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "dpos_company_bindings_dpos_company_id_key" ON "dpos_company_bindings"("dpos_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "dpos_service_identities_identity_id_key" ON "dpos_service_identities"("identity_id");

-- CreateIndex
CREATE INDEX "dpos_service_identities_dpos_company_id_status_idx" ON "dpos_service_identities"("dpos_company_id", "status");

-- CreateIndex
CREATE INDEX "dpos_audit_events_category_at_idx" ON "dpos_audit_events"("category", "at");

-- CreateIndex
CREATE INDEX "dpos_audit_events_subject_type_subject_id_idx" ON "dpos_audit_events"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "dpos_refresh_attempts_dpos_company_id_started_at_idx" ON "dpos_refresh_attempts"("dpos_company_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "dpos_refresh_attempts_dpos_company_id_trigger_scheduled_for_key" ON "dpos_refresh_attempts"("dpos_company_id", "trigger", "scheduled_for");

-- CreateIndex
CREATE INDEX "dpos_results_return_outbox_sync_status_next_attempt_at_idx" ON "dpos_results_return_outbox"("sync_status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "dpos_results_return_outbox_dpos_company_id_candidate_id_idx" ON "dpos_results_return_outbox"("dpos_company_id", "candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "dpos_results_return_outbox_dpos_company_id_producer_event_id_key" ON "dpos_results_return_outbox"("dpos_company_id", "producer_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "dpos_results_return_outbox_dpos_company_id_operation_key_key" ON "dpos_results_return_outbox"("dpos_company_id", "operation_key");

-- CreateIndex
CREATE INDEX "dpos_results_return_outbox_attempts_outbox_id_at_idx" ON "dpos_results_return_outbox_attempts"("outbox_id", "at");

-- CreateIndex
CREATE INDEX "iam_core_candidates_dpos_company_id_lifecycle_state_idx" ON "iam_core_candidates"("dpos_company_id", "lifecycle_state");

-- CreateIndex
CREATE INDEX "iam_core_candidates_dpos_company_id_grouped_condition_key_idx" ON "iam_core_candidates"("dpos_company_id", "grouped_condition_key");

-- CreateIndex
CREATE UNIQUE INDEX "iam_core_system_recommendations_candidate_id_recommendation_version_key" ON "iam_core_system_recommendations"("candidate_id", "recommendation_version");

-- CreateIndex
CREATE UNIQUE INDEX "iam_core_management_plans_candidate_id_plan_version_key" ON "iam_core_management_plans"("candidate_id", "plan_version");

-- CreateIndex
CREATE INDEX "iam_core_ownerships_candidate_id_ended_at_idx" ON "iam_core_ownerships"("candidate_id", "ended_at");

-- CreateIndex
CREATE UNIQUE INDEX "iam_core_contributors_ownership_id_user_id_key" ON "iam_core_contributors"("ownership_id", "user_id");

-- ---------------------------------------------------------------------------------------------------------------------
-- Governance constraints that Prisma's schema language cannot express (SQLite triggers / partial indexes).
-- They enforce, in the database itself, the Stage 4A rules:
--   * the original system recommendation is never overwritten or deleted;
--   * a closed candidate (and its outcome) is never silently reopened or edited;
--   * at most one OPEN candidate exists per (company, grouped condition); a recurrence is a NEW candidate;
--   * the producer outbox is never deleted from, and an accepted event is never altered;
--   * audit and attempt ledgers are append-only.
-- ---------------------------------------------------------------------------------------------------------------

-- One open candidate per grouped condition (a closed condition may recur only as a new, linked candidate).
CREATE UNIQUE INDEX "iam_core_candidates_one_open_per_condition"
  ON "iam_core_candidates"("dpos_company_id", "grouped_condition_key")
  WHERE "closed_at" IS NULL;

-- A candidate is never deleted.
CREATE TRIGGER "iam_core_candidates_no_delete" BEFORE DELETE ON "iam_core_candidates"
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_CANDIDATE_NOT_DELETABLE');
END;

-- Closed candidates are immutable: no reopen, no state change, no clearing of closed_at.
CREATE TRIGGER "iam_core_candidates_closed_no_reopen" BEFORE UPDATE ON "iam_core_candidates"
WHEN OLD."closed_at" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN');
END;

-- Identity columns of a candidate never change.
CREATE TRIGGER "iam_core_candidates_identity_immutable" BEFORE UPDATE ON "iam_core_candidates"
WHEN NEW."candidate_id" IS NOT OLD."candidate_id"
  OR NEW."dpos_company_id" IS NOT OLD."dpos_company_id"
  OR NEW."grouped_condition_key" IS NOT OLD."grouped_condition_key"
  OR NEW."original_created_at" IS NOT OLD."original_created_at"
  OR NEW."recurrence_of_candidate_id" IS NOT OLD."recurrence_of_candidate_id"
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_CANDIDATE_IDENTITY_IMMUTABLE');
END;

-- System recommendations are append-only versions: never updated, never deleted.
CREATE TRIGGER "iam_core_system_recommendations_no_update" BEFORE UPDATE ON "iam_core_system_recommendations"
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_SYSTEM_RECOMMENDATION_IMMUTABLE');
END;
CREATE TRIGGER "iam_core_system_recommendations_no_delete" BEFORE DELETE ON "iam_core_system_recommendations"
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_SYSTEM_RECOMMENDATION_IMMUTABLE');
END;

-- Nothing new may be attached to a closed candidate.
CREATE TRIGGER "iam_core_system_recommendations_closed_no_insert" BEFORE INSERT ON "iam_core_system_recommendations"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN');
END;
CREATE TRIGGER "iam_core_management_plans_closed_no_insert" BEFORE INSERT ON "iam_core_management_plans"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN');
END;
CREATE TRIGGER "iam_core_management_plans_closed_no_update" BEFORE UPDATE ON "iam_core_management_plans"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = OLD."candidate_id") IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN');
END;
CREATE TRIGGER "iam_core_ownerships_closed_no_insert" BEFORE INSERT ON "iam_core_ownerships"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN');
END;
CREATE TRIGGER "iam_core_ownerships_closed_no_update" BEFORE UPDATE ON "iam_core_ownerships"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = OLD."candidate_id") IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN');
END;
CREATE TRIGGER "iam_core_execution_states_closed_no_insert" BEFORE INSERT ON "iam_core_execution_states"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN');
END;
CREATE TRIGGER "iam_core_execution_states_closed_no_update" BEFORE UPDATE ON "iam_core_execution_states"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = OLD."candidate_id") IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN');
END;

-- Once closeout is recorded the outcome is immutable and never deleted.
CREATE TRIGGER "iam_core_outcomes_closed_immutable" BEFORE UPDATE ON "iam_core_outcomes"
WHEN OLD."closeout_at" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_OUTCOME_IMMUTABLE');
END;
CREATE TRIGGER "iam_core_outcomes_no_delete" BEFORE DELETE ON "iam_core_outcomes"
BEGIN
  SELECT RAISE(ABORT, 'IAM_CORE_OUTCOME_NOT_DELETABLE');
END;

-- Producer outbox: an event is never deleted; identity never changes; an accepted event is final.
CREATE TRIGGER "dpos_results_return_outbox_no_delete" BEFORE DELETE ON "dpos_results_return_outbox"
BEGIN
  SELECT RAISE(ABORT, 'DPOS_OUTBOX_EVENT_NOT_DELETABLE');
END;
CREATE TRIGGER "dpos_results_return_outbox_identity_immutable" BEFORE UPDATE ON "dpos_results_return_outbox"
WHEN NEW."producer_event_id" IS NOT OLD."producer_event_id"
  OR NEW."dpos_company_id" IS NOT OLD."dpos_company_id"
  OR NEW."candidate_id" IS NOT OLD."candidate_id"
  OR NEW."event_type" IS NOT OLD."event_type"
  OR NEW."contract_id" IS NOT OLD."contract_id"
  OR NEW."created_at" IS NOT OLD."created_at"
BEGIN
  SELECT RAISE(ABORT, 'DPOS_OUTBOX_EVENT_IDENTITY_IMMUTABLE');
END;
CREATE TRIGGER "dpos_results_return_outbox_synced_final" BEFORE UPDATE ON "dpos_results_return_outbox"
WHEN OLD."sync_status" = 'SYNCED'
  AND (NEW."sync_status" IS NOT 'SYNCED'
    OR NEW."payload_json" IS NOT OLD."payload_json"
    OR NEW."payload_hash" IS NOT OLD."payload_hash")
BEGIN
  SELECT RAISE(ABORT, 'DPOS_OUTBOX_ACCEPTED_EVENT_FINAL');
END;

-- Append-only ledgers.
CREATE TRIGGER "dpos_results_return_outbox_attempts_no_update" BEFORE UPDATE ON "dpos_results_return_outbox_attempts"
BEGIN
  SELECT RAISE(ABORT, 'DPOS_LEDGER_APPEND_ONLY');
END;
CREATE TRIGGER "dpos_results_return_outbox_attempts_no_delete" BEFORE DELETE ON "dpos_results_return_outbox_attempts"
BEGIN
  SELECT RAISE(ABORT, 'DPOS_LEDGER_APPEND_ONLY');
END;
CREATE TRIGGER "dpos_audit_events_no_update" BEFORE UPDATE ON "dpos_audit_events"
BEGIN
  SELECT RAISE(ABORT, 'DPOS_LEDGER_APPEND_ONLY');
END;
CREATE TRIGGER "dpos_audit_events_no_delete" BEFORE DELETE ON "dpos_audit_events"
BEGIN
  SELECT RAISE(ABORT, 'DPOS_LEDGER_APPEND_ONLY');
END;
