-- Stage 4E: formal closeout, outcome attribution, recurrence and learning.
-- ADDITIVE ONLY: creates new tables/indexes/triggers. No V1.5, Stage 4A, Stage 4B, Stage 4C or Stage 4D table is altered, dropped or
-- repurposed (the populated Stage 4B/4C/4D tables are untouched). Reverse with down.sql via scripts/iam-migrate.ts rollback-4e
-- (backup first; refuses to discard closeout / learning data unless explicitly told to).

-- CreateTable
CREATE TABLE "iam_core_closeouts" (
    "closeout_id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "grouped_condition_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "approved_version" INTEGER,
    "plan_version" INTEGER,
    "recommendation_version" INTEGER,
    "started_at" DATETIME NOT NULL,
    "started_by" TEXT NOT NULL,
    "started_by_role" TEXT NOT NULL,
    "approved_at" DATETIME,
    "approved_by" TEXT,
    "closed_at" DATETIME,
    "closed_by" TEXT,
    "final_resolution_status" TEXT,
    "final_attribution_category" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "iam_core_closeouts_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_closeout_versions" (
    "version_id" TEXT NOT NULL PRIMARY KEY,
    "closeout_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "closeout_version" INTEGER NOT NULL,
    "supersedes_version" INTEGER,
    "assessment_kind" TEXT NOT NULL,
    "recorded_at" DATETIME NOT NULL,
    "recorded_by" TEXT NOT NULL,
    "recorded_by_role" TEXT NOT NULL,
    "action_completed_at" DATETIME,
    "action_completion_pct" REAL,
    "measurement_start" DATETIME,
    "measurement_end" DATETIME,
    "evidence_current_through" DATETIME,
    "next_measurement_date" DATETIME,
    "not_yet_measured_reason" TEXT,
    "required_evidence_json" TEXT,
    "baseline_exposure" REAL,
    "final_exposure" REAL,
    "exposure_unit" TEXT,
    "condition_reduction_pct" REAL,
    "condition_reduction_state" TEXT NOT NULL,
    "residual_json" TEXT,
    "expected_vs_actual_json" TEXT,
    "business_impact_json" TEXT,
    "recommended_status" TEXT,
    "judgement_required" BOOLEAN NOT NULL DEFAULT false,
    "recommendation_basis_json" TEXT NOT NULL,
    "assessed_status" TEXT NOT NULL,
    "assessment_override_reason" TEXT,
    "outcome_confidence" TEXT NOT NULL,
    "outcome_confidence_rationale" TEXT,
    "attribution_category" TEXT NOT NULL,
    "attribution_rationale" TEXT NOT NULL,
    "attribution_confidence" TEXT NOT NULL,
    "attribution_evidence_json" TEXT,
    "alternatives_json" TEXT,
    "recurrence_risk" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "recurrence_risk_rationale" TEXT,
    "follow_up_recommendation" TEXT,
    "data_limitations_json" TEXT,
    "evidence_refs_json" TEXT,
    "observation_refs_json" TEXT,
    "scoring_context_json" TEXT,
    "health_context_json" TEXT,
    "plan_context_json" TEXT,
    "coi_json" TEXT,
    "content_hash" TEXT NOT NULL,
    CONSTRAINT "iam_core_closeout_versions_closeout_id_fkey" FOREIGN KEY ("closeout_id") REFERENCES "iam_core_closeouts" ("closeout_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_closeout_approvals" (
    "approval_id" TEXT NOT NULL PRIMARY KEY,
    "closeout_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "closeout_version" INTEGER NOT NULL,
    "recommended_status" TEXT,
    "assessed_status" TEXT NOT NULL,
    "final_status" TEXT NOT NULL,
    "override_reason" TEXT,
    "approved_by" TEXT NOT NULL,
    "approved_by_role" TEXT NOT NULL,
    "approved_at" DATETIME NOT NULL,
    "note" TEXT,
    "learning_not_applicable_reason" TEXT,
    CONSTRAINT "iam_core_closeout_approvals_closeout_id_fkey" FOREIGN KEY ("closeout_id") REFERENCES "iam_core_closeouts" ("closeout_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "iam_core_closeout_approvals_closeout_id_closeout_version_fkey" FOREIGN KEY ("closeout_id", "closeout_version") REFERENCES "iam_core_closeout_versions" ("closeout_id", "closeout_version") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_closeout_history" (
    "history_id" TEXT NOT NULL PRIMARY KEY,
    "closeout_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "closeout_version" INTEGER,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "reason" TEXT,
    "detail_json" TEXT,
    "at" DATETIME NOT NULL,
    CONSTRAINT "iam_core_closeout_history_closeout_id_fkey" FOREIGN KEY ("closeout_id") REFERENCES "iam_core_closeouts" ("closeout_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_learning_records" (
    "learning_id" TEXT NOT NULL PRIMARY KEY,
    "closeout_id" TEXT NOT NULL,
    "closeout_version" INTEGER NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "grouped_condition_key" TEXT NOT NULL,
    "action_type" TEXT,
    "department" TEXT,
    "owner_role" TEXT,
    "condition_type" TEXT,
    "condition_family" TEXT,
    "condition_family_version" TEXT,
    "condition_family_source" TEXT,
    "category" TEXT,
    "recommendation_text" TEXT,
    "plan_summary" TEXT,
    "management_response" TEXT NOT NULL,
    "deviation_reason" TEXT,
    "management_path_json" TEXT,
    "execution_result_json" TEXT NOT NULL,
    "condition_result_json" TEXT NOT NULL,
    "assessed_status" TEXT NOT NULL,
    "attribution_category" TEXT NOT NULL,
    "outcome_confidence" TEXT NOT NULL,
    "expected_vs_actual_json" TEXT,
    "time_to_result_days" REAL,
    "recurrence_sequence" INTEGER NOT NULL DEFAULT 1,
    "recurrence_json" TEXT,
    "what_worked" TEXT,
    "what_did_not_work" TEXT,
    "barriers_json" TEXT,
    "assumptions_json" TEXT,
    "dependencies_json" TEXT,
    "future_handling" TEXT,
    "data_limitations_json" TEXT,
    "evidence_refs_json" TEXT,
    "recorded_by" TEXT NOT NULL,
    "recorded_by_role" TEXT NOT NULL,
    "recorded_at" DATETIME NOT NULL,
    CONSTRAINT "iam_core_learning_records_closeout_id_fkey" FOREIGN KEY ("closeout_id") REFERENCES "iam_core_closeouts" ("closeout_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_recurrence_links" (
    "recurrence_id" TEXT NOT NULL PRIMARY KEY,
    "dpos_company_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "prior_candidate_id" TEXT NOT NULL,
    "grouped_condition_key" TEXT NOT NULL,
    "recurrence_sequence" INTEGER NOT NULL,
    "recurrence_count" INTEGER NOT NULL,
    "match_status" TEXT NOT NULL,
    "match_basis" TEXT NOT NULL,
    "match_detail_json" TEXT,
    "prior_resolution_status" TEXT,
    "prior_closeout_at" DATETIME,
    "prior_plan_summary" TEXT,
    "prior_action_summary" TEXT,
    "supersedes_recurrence_id" TEXT,
    "decided_by" TEXT,
    "decided_by_role" TEXT,
    "decision_reason" TEXT,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "iam_core_recurrence_links_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "iam_core_recurrence_links_prior_candidate_id_fkey" FOREIGN KEY ("prior_candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "iam_core_closeouts_candidate_id_key" ON "iam_core_closeouts"("candidate_id");

-- CreateIndex
CREATE INDEX "iam_core_closeouts_dpos_company_id_status_idx" ON "iam_core_closeouts"("dpos_company_id", "status");

-- CreateIndex
CREATE INDEX "iam_core_closeout_versions_candidate_id_closeout_version_idx" ON "iam_core_closeout_versions"("candidate_id", "closeout_version");

-- CreateIndex
CREATE UNIQUE INDEX "iam_core_closeout_versions_closeout_id_closeout_version_key" ON "iam_core_closeout_versions"("closeout_id", "closeout_version");

-- CreateIndex
CREATE UNIQUE INDEX "iam_core_closeout_approvals_closeout_id_closeout_version_key" ON "iam_core_closeout_approvals"("closeout_id", "closeout_version");

-- CreateIndex
CREATE INDEX "iam_core_closeout_history_closeout_id_at_idx" ON "iam_core_closeout_history"("closeout_id", "at");

-- CreateIndex
CREATE INDEX "iam_core_closeout_history_candidate_id_at_idx" ON "iam_core_closeout_history"("candidate_id", "at");

-- CreateIndex
CREATE INDEX "iam_core_learning_records_dpos_company_id_recorded_at_idx" ON "iam_core_learning_records"("dpos_company_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "iam_core_learning_records_closeout_id_closeout_version_key" ON "iam_core_learning_records"("closeout_id", "closeout_version");

-- CreateIndex
CREATE INDEX "iam_core_recurrence_links_dpos_company_id_match_status_idx" ON "iam_core_recurrence_links"("dpos_company_id", "match_status");

-- CreateIndex
CREATE INDEX "iam_core_recurrence_links_candidate_id_idx" ON "iam_core_recurrence_links"("candidate_id");

-- CreateIndex
CREATE INDEX "iam_core_recurrence_links_prior_candidate_id_idx" ON "iam_core_recurrence_links"("prior_candidate_id");

-- ---------------------------------------------------------------------------------------------------------------------
-- Triggers (the same guards the Stage 4B ledgers carry).
-- ---------------------------------------------------------------------------------------------------------------------

-- The closeout case: never deleted; its identity never changes; once CLOSED nothing changes again; status vocabulary is closed.
CREATE TRIGGER "iam_core_closeouts_no_delete" BEFORE DELETE ON "iam_core_closeouts" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSEOUT_NOT_DELETABLE'); END;
CREATE TRIGGER "iam_core_closeouts_closed_immutable" BEFORE UPDATE ON "iam_core_closeouts"
WHEN OLD."status" = 'CLOSED'
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CLOSEOUT_IMMUTABLE'); END;
CREATE TRIGGER "iam_core_closeouts_identity_immutable" BEFORE UPDATE ON "iam_core_closeouts"
WHEN NEW."closeout_id" IS NOT OLD."closeout_id" OR NEW."candidate_id" IS NOT OLD."candidate_id" OR NEW."dpos_company_id" IS NOT OLD."dpos_company_id" OR NEW."started_at" IS NOT OLD."started_at"
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSEOUT_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER "iam_core_closeouts_vocab_insert" BEFORE INSERT ON "iam_core_closeouts"
WHEN NEW."status" NOT IN ('STARTED', 'MEASURED', 'APPROVED', 'CLOSED')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSEOUT_STATUS_VOCABULARY'); END;
CREATE TRIGGER "iam_core_closeouts_vocab_update" BEFORE UPDATE ON "iam_core_closeouts"
WHEN NEW."status" NOT IN ('STARTED', 'MEASURED', 'APPROVED', 'CLOSED')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSEOUT_STATUS_VOCABULARY'); END;
CREATE TRIGGER "iam_core_closeouts_final_vocab_update" BEFORE UPDATE ON "iam_core_closeouts"
WHEN NEW."final_resolution_status" IS NOT NULL AND NEW."final_resolution_status" NOT IN ('FULLY_RESOLVED', 'SUBSTANTIALLY_RESOLVED', 'PARTIALLY_RESOLVED', 'CONTROLLED_BUT_CONTINUING', 'UNSUCCESSFUL', 'NO_LONGER_APPLICABLE')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_FINAL_RESOLUTION_VOCABULARY'); END;
CREATE TRIGGER "iam_core_closeouts_closed_no_insert" BEFORE INSERT ON "iam_core_closeouts"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;

-- Versions, approvals, history and learning records: append-only; nothing is added once the candidate is closed.
CREATE TRIGGER "iam_core_closeout_versions_no_update" BEFORE UPDATE ON "iam_core_closeout_versions" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_closeout_versions_no_delete" BEFORE DELETE ON "iam_core_closeout_versions" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_closeout_approvals_no_update" BEFORE UPDATE ON "iam_core_closeout_approvals" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_closeout_approvals_no_delete" BEFORE DELETE ON "iam_core_closeout_approvals" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_closeout_history_no_update" BEFORE UPDATE ON "iam_core_closeout_history" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_closeout_history_no_delete" BEFORE DELETE ON "iam_core_closeout_history" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_learning_records_no_update" BEFORE UPDATE ON "iam_core_learning_records" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_learning_records_no_delete" BEFORE DELETE ON "iam_core_learning_records" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_recurrence_links_no_update" BEFORE UPDATE ON "iam_core_recurrence_links" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_recurrence_links_no_delete" BEFORE DELETE ON "iam_core_recurrence_links" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_closeout_versions_closed_no_insert" BEFORE INSERT ON "iam_core_closeout_versions"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_closeout_approvals_closed_no_insert" BEFORE INSERT ON "iam_core_closeout_approvals"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_closeout_history_closed_no_insert" BEFORE INSERT ON "iam_core_closeout_history"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_learning_records_closed_no_insert" BEFORE INSERT ON "iam_core_learning_records"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;

-- Closed vocabularies (the nine resolution statuses, the six final ones, six attribution categories, four confidence levels).
CREATE TRIGGER "iam_core_closeout_versions_vocab_assessed_status_insert" BEFORE INSERT ON "iam_core_closeout_versions"
WHEN NEW."assessed_status" NOT IN ('NOT_YET_MEASURED', 'IMPROVING', 'ON_TARGET', 'FULLY_RESOLVED', 'SUBSTANTIALLY_RESOLVED', 'PARTIALLY_RESOLVED', 'CONTROLLED_BUT_CONTINUING', 'UNSUCCESSFUL', 'NO_LONGER_APPLICABLE')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_RESOLUTION_STATUS_VOCABULARY'); END;
CREATE TRIGGER "iam_core_closeout_versions_vocab_recommended_status_insert" BEFORE INSERT ON "iam_core_closeout_versions"
WHEN NEW."recommended_status" IS NOT NULL AND NEW."recommended_status" NOT IN ('NOT_YET_MEASURED', 'IMPROVING', 'ON_TARGET', 'FULLY_RESOLVED', 'SUBSTANTIALLY_RESOLVED', 'PARTIALLY_RESOLVED', 'CONTROLLED_BUT_CONTINUING', 'UNSUCCESSFUL', 'NO_LONGER_APPLICABLE')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_RESOLUTION_STATUS_VOCABULARY'); END;
CREATE TRIGGER "iam_core_closeout_versions_vocab_attribution_category_insert" BEFORE INSERT ON "iam_core_closeout_versions"
WHEN NEW."attribution_category" NOT IN ('CONFIRMED_CONTRIBUTION', 'PROBABLE_CONTRIBUTION', 'POSSIBLE_CONTRIBUTION', 'UNCLEAR_INSUFFICIENT_EVIDENCE', 'UNRELATED_EXTERNAL_CAUSE', 'NEGATIVE_COUNTERPRODUCTIVE_EFFECT')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_ATTRIBUTION_CATEGORY_VOCABULARY'); END;
CREATE TRIGGER "iam_core_closeout_versions_vocab_attribution_confidence_insert" BEFORE INSERT ON "iam_core_closeout_versions"
WHEN NEW."attribution_confidence" NOT IN ('HIGH', 'MODERATE', 'LOW', 'NOT_MEASURABLE')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_ATTRIBUTION_CONFIDENCE_VOCABULARY'); END;
CREATE TRIGGER "iam_core_closeout_versions_vocab_outcome_confidence_insert" BEFORE INSERT ON "iam_core_closeout_versions"
WHEN NEW."outcome_confidence" NOT IN ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_OUTCOME_CONFIDENCE_VOCABULARY'); END;
CREATE TRIGGER "iam_core_closeout_versions_vocab_recurrence_risk_insert" BEFORE INSERT ON "iam_core_closeout_versions"
WHEN NEW."recurrence_risk" NOT IN ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_RECURRENCE_RISK_VOCABULARY'); END;
CREATE TRIGGER "iam_core_closeout_versions_vocab_condition_reduction_state_insert" BEFORE INSERT ON "iam_core_closeout_versions"
WHEN NEW."condition_reduction_state" NOT IN ('MEASURED', 'NOT_MEASURABLE')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CONDITION_REDUCTION_STATE_VOCABULARY'); END;
CREATE TRIGGER "iam_core_closeout_versions_vocab_assessment_kind_insert" BEFORE INSERT ON "iam_core_closeout_versions"
WHEN NEW."assessment_kind" NOT IN ('MEASUREMENT', 'NOT_YET_MEASURED')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_ASSESSMENT_KIND_VOCABULARY'); END;
CREATE TRIGGER "iam_core_closeout_approvals_vocab_final_status_insert" BEFORE INSERT ON "iam_core_closeout_approvals"
WHEN NEW."final_status" NOT IN ('FULLY_RESOLVED', 'SUBSTANTIALLY_RESOLVED', 'PARTIALLY_RESOLVED', 'CONTROLLED_BUT_CONTINUING', 'UNSUCCESSFUL', 'NO_LONGER_APPLICABLE')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_FINAL_RESOLUTION_VOCABULARY'); END;
CREATE TRIGGER "iam_core_learning_records_vocab_management_response_insert" BEFORE INSERT ON "iam_core_learning_records"
WHEN NEW."management_response" NOT IN ('FOLLOWED', 'MODIFIED', 'SELECTED_ALTERNATIVE', 'REJECTED_THEN_APPROVED', 'DELAYED', 'SUPPRESSED_THEN_APPROVED')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_MANAGEMENT_RESPONSE_VOCABULARY'); END;
CREATE TRIGGER "iam_core_learning_records_vocab_attribution_category_insert" BEFORE INSERT ON "iam_core_learning_records"
WHEN NEW."attribution_category" NOT IN ('CONFIRMED_CONTRIBUTION', 'PROBABLE_CONTRIBUTION', 'POSSIBLE_CONTRIBUTION', 'UNCLEAR_INSUFFICIENT_EVIDENCE', 'UNRELATED_EXTERNAL_CAUSE', 'NEGATIVE_COUNTERPRODUCTIVE_EFFECT')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_ATTRIBUTION_CATEGORY_VOCABULARY'); END;
CREATE TRIGGER "iam_core_recurrence_links_vocab_match_status_insert" BEFORE INSERT ON "iam_core_recurrence_links"
WHEN NEW."match_status" NOT IN ('LINKED', 'REQUIRES_REVIEW', 'REVIEW_CONFIRMED', 'REVIEW_DECLINED')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_RECURRENCE_MATCH_STATUS_VOCABULARY'); END;
CREATE TRIGGER "iam_core_recurrence_links_vocab_match_basis_insert" BEFORE INSERT ON "iam_core_recurrence_links"
WHEN NEW."match_basis" NOT IN ('EXACT_GROUPED_KEY', 'FACET_OVERLAP', 'EVIDENCE_OVERLAP')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_RECURRENCE_MATCH_BASIS_VOCABULARY'); END;

-- ---------------------------------------------------------------------------------------------------------------------
-- Governed condition family (Product Owner decision 4E-C4). The family is a stable code from a versioned governed vocabulary (kept in
-- code, so a new family is a governed vocabulary change, not a schema change); the candidate-specific condition detail stays in the
-- candidate's grouped-condition facets and in iam_core_learning_records.condition_type. One immutable classification per candidate.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE "iam_core_condition_classifications" (
    "candidate_id" TEXT NOT NULL PRIMARY KEY,
    "dpos_company_id" TEXT NOT NULL,
    "family_code" TEXT NOT NULL,
    "vocabulary_version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "classified_by" TEXT NOT NULL,
    "classified_at" DATETIME NOT NULL,
    "detail_json" TEXT,
    CONSTRAINT "iam_core_condition_classifications_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "iam_core_condition_classifications_dpos_company_id_family_code_idx" ON "iam_core_condition_classifications"("dpos_company_id", "family_code");
CREATE TRIGGER "iam_core_condition_classifications_no_update" BEFORE UPDATE ON "iam_core_condition_classifications" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_condition_classifications_no_delete" BEFORE DELETE ON "iam_core_condition_classifications" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_condition_classifications_source_vocab_insert" BEFORE INSERT ON "iam_core_condition_classifications"
WHEN NEW."source" NOT IN ('PRODUCER', 'MANAGEMENT')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CONDITION_FAMILY_SOURCE_VOCABULARY'); END;
