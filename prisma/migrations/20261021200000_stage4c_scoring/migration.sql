-- Stage 4C: deterministic IAM scoring, ranking, confidence, modifiers, emergency review and domain-priority governance.
-- ADDITIVE ONLY: creates new tables/indexes/triggers. No V1.5 table, no Stage 4A table and no Stage 4B table is altered,
-- dropped or repurposed. Generated with `prisma migrate diff` from the Stage 4B schema (3f1df49) to the Stage 4C schema,
-- plus the governance section at the end. Reverse with down.sql via scripts/iam-migrate.ts rollback-4c
-- (backup first; refuses to discard scoring data unless explicitly told to).-- CreateTable
CREATE TABLE "iam_core_scoring_inputs" (
    "input_id" TEXT NOT NULL PRIMARY KEY,
    "candidate_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "input_version" INTEGER NOT NULL,
    "inputs_json" TEXT NOT NULL,
    "inputs_hash" TEXT NOT NULL,
    "source_refs_json" TEXT,
    "recorded_by" TEXT NOT NULL,
    "recorded_at" DATETIME NOT NULL,
    CONSTRAINT "iam_core_scoring_inputs_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_scoring_runs" (
    "scoring_run_id" TEXT NOT NULL PRIMARY KEY,
    "dpos_company_id" TEXT NOT NULL,
    "run_key" TEXT,
    "run_at" DATETIME NOT NULL,
    "scoring_version" TEXT NOT NULL,
    "config_version" TEXT NOT NULL,
    "config_hash" TEXT NOT NULL,
    "config_json" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "requested_by_role" TEXT NOT NULL,
    "source_refs_json" TEXT,
    "candidates_considered" INTEGER NOT NULL,
    "candidates_ranked" INTEGER NOT NULL,
    "candidates_excluded" INTEGER NOT NULL,
    "top2_json" TEXT NOT NULL,
    "company_time_zone" TEXT,
    "operating_week_start" TEXT,
    "summary_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "iam_core_score_results" (
    "score_result_id" TEXT NOT NULL PRIMARY KEY,
    "scoring_run_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "dpos_company_id" TEXT NOT NULL,
    "grouped_condition_key" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "exclusion_reason" TEXT,
    "exclusion_detail" TEXT,
    "input_id" TEXT,
    "input_version" INTEGER,
    "workflow_state" TEXT,
    "raw_core_score" REAL,
    "data_confidence" TEXT,
    "confidence_multiplier" REAL,
    "confidence_adjusted_core_score" REAL,
    "uncapped_modifier_total" REAL,
    "capped_modifier_total" REAL,
    "uncapped_domain_score" REAL,
    "domain_score" REAL,
    "priority_band" TEXT,
    "calculated_rank" INTEGER,
    "displayed_rank" INTEGER,
    "previous_calculated_rank" INTEGER,
    "effective_score" REAL,
    "top2_qualified" BOOLEAN NOT NULL DEFAULT false,
    "emergency_review_candidate" BOOLEAN NOT NULL DEFAULT false,
    "critical_outside_top2" BOOLEAN NOT NULL DEFAULT false,
    "forced_review_required" BOOLEAN NOT NULL DEFAULT false,
    "breakdown_json" TEXT,
    "tie_break_json" TEXT,
    "operating_week_start" TEXT,
    "mathematical_domain_score" REAL,
    "score_flags_json" TEXT,
    "scoring_state" TEXT,
    "scoring_state_reason" TEXT,
    "published_scoring_state" TEXT,
    "additional_emergency_review_required" BOOLEAN NOT NULL DEFAULT false,
    "published_event_type" TEXT,
    "published_outbox_id" TEXT,
    "scored_at" DATETIME NOT NULL,
    CONSTRAINT "iam_core_score_results_scoring_run_id_fkey" FOREIGN KEY ("scoring_run_id") REFERENCES "iam_core_scoring_runs" ("scoring_run_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "iam_core_score_results_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_priority_governance" (
    "governance_id" TEXT NOT NULL PRIMARY KEY,
    "batch_id" TEXT,
    "dpos_company_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "points" REAL,
    "magnitude_class" TEXT,
    "detail_json" TEXT,
    "effective_at" DATETIME NOT NULL,
    "expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "iam_core_priority_governance_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_forced_reviews" (
    "review_id" TEXT NOT NULL PRIMARY KEY,
    "dpos_company_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "detail" TEXT,
    "raised_at" DATETIME NOT NULL,
    "raised_by_run_id" TEXT,
    "resolved_at" DATETIME,
    "resolved_by" TEXT,
    "resolution_basis" TEXT,
    "resolution" TEXT,
    CONSTRAINT "iam_core_forced_reviews_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_emergency_reviews" (
    "emergency_review_id" TEXT NOT NULL PRIMARY KEY,
    "dpos_company_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "triggers_json" TEXT NOT NULL,
    "raised_run_id" TEXT,
    "raised_at" DATETIME NOT NULL,
    "additional_emergency" BOOLEAN NOT NULL DEFAULT false,
    "decided_by" TEXT,
    "decided_at" DATETIME,
    "decision_reason" TEXT,
    CONSTRAINT "iam_core_emergency_reviews_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_core_display_changes" (
    "display_change_id" TEXT NOT NULL PRIMARY KEY,
    "dpos_company_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "governance_id" TEXT NOT NULL,
    "based_on_score_result_id" TEXT NOT NULL,
    "state_json" TEXT NOT NULL,
    "published_event_type" TEXT,
    "published_outbox_id" TEXT,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "iam_core_display_changes_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "iam_core_candidates" ("candidate_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "iam_core_display_changes_candidate_id_created_at_idx" ON "iam_core_display_changes"("candidate_id", "created_at");

-- CreateIndex
CREATE INDEX "iam_core_display_changes_dpos_company_id_created_at_idx" ON "iam_core_display_changes"("dpos_company_id", "created_at");

-- CreateIndex
CREATE INDEX "iam_core_scoring_inputs_dpos_company_id_candidate_id_idx" ON "iam_core_scoring_inputs"("dpos_company_id", "candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "iam_core_scoring_inputs_candidate_id_input_version_key" ON "iam_core_scoring_inputs"("candidate_id", "input_version");

-- CreateIndex
CREATE INDEX "iam_core_scoring_runs_dpos_company_id_run_at_idx" ON "iam_core_scoring_runs"("dpos_company_id", "run_at");

-- CreateIndex
CREATE UNIQUE INDEX "iam_core_scoring_runs_dpos_company_id_run_key_key" ON "iam_core_scoring_runs"("dpos_company_id", "run_key");

-- CreateIndex
CREATE INDEX "iam_core_score_results_candidate_id_scored_at_idx" ON "iam_core_score_results"("candidate_id", "scored_at");

-- CreateIndex
CREATE INDEX "iam_core_score_results_dpos_company_id_scored_at_idx" ON "iam_core_score_results"("dpos_company_id", "scored_at");

-- CreateIndex
CREATE UNIQUE INDEX "iam_core_score_results_scoring_run_id_candidate_id_key" ON "iam_core_score_results"("scoring_run_id", "candidate_id");

-- CreateIndex
CREATE INDEX "iam_core_priority_governance_candidate_id_action_type_effective_at_idx" ON "iam_core_priority_governance"("candidate_id", "action_type", "effective_at");

-- CreateIndex
CREATE INDEX "iam_core_priority_governance_dpos_company_id_action_type_idx" ON "iam_core_priority_governance"("dpos_company_id", "action_type");

-- CreateIndex
CREATE INDEX "iam_core_forced_reviews_dpos_company_id_status_idx" ON "iam_core_forced_reviews"("dpos_company_id", "status");

-- CreateIndex
CREATE INDEX "iam_core_forced_reviews_candidate_id_reason_code_status_idx" ON "iam_core_forced_reviews"("candidate_id", "reason_code", "status");

-- CreateIndex
CREATE INDEX "iam_core_emergency_reviews_dpos_company_id_status_idx" ON "iam_core_emergency_reviews"("dpos_company_id", "status");

-- CreateIndex
CREATE INDEX "iam_core_emergency_reviews_candidate_id_status_idx" ON "iam_core_emergency_reviews"("candidate_id", "status");

-- ===== Governance: immutability and vocabulary =====================================================================
-- Scoring facts, runs, results and the governance ledger are append-only: they are the audit trail of every score.
CREATE TRIGGER "iam_core_scoring_inputs_no_update" BEFORE UPDATE ON "iam_core_scoring_inputs" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_scoring_inputs_no_delete" BEFORE DELETE ON "iam_core_scoring_inputs" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_scoring_runs_no_update" BEFORE UPDATE ON "iam_core_scoring_runs" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_scoring_runs_no_delete" BEFORE DELETE ON "iam_core_scoring_runs" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_score_results_no_update" BEFORE UPDATE ON "iam_core_score_results" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_score_results_no_delete" BEFORE DELETE ON "iam_core_score_results" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_priority_governance_no_update" BEFORE UPDATE ON "iam_core_priority_governance" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_priority_governance_no_delete" BEFORE DELETE ON "iam_core_priority_governance" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_display_changes_no_update" BEFORE UPDATE ON "iam_core_display_changes" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_display_changes_no_delete" BEFORE DELETE ON "iam_core_display_changes" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_forced_reviews_no_delete" BEFORE DELETE ON "iam_core_forced_reviews" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_emergency_reviews_no_delete" BEFORE DELETE ON "iam_core_emergency_reviews" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;

-- Vocabulary guards.
CREATE TRIGGER "iam_core_scoring_runs_vocab_insert" BEFORE INSERT ON "iam_core_scoring_runs"
WHEN NEW."status" NOT IN ('FINALIZED')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_SCORING_VOCABULARY'); END;
CREATE TRIGGER "iam_core_score_results_vocab_insert" BEFORE INSERT ON "iam_core_score_results"
WHEN NEW."outcome" NOT IN ('RANKED', 'EXCLUDED')
  OR (NEW."priority_band" IS NOT NULL AND NEW."priority_band" NOT IN ('CRITICAL', 'HIGH', 'MODERATE', 'WATCH', 'INFORMATIONAL'))
  OR (NEW."data_confidence" IS NOT NULL AND NEW."data_confidence" NOT IN ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'))
  OR (NEW."outcome" = 'RANKED' AND (NEW."domain_score" IS NULL OR NEW."calculated_rank" IS NULL OR NEW."priority_band" IS NULL))
  OR (NEW."outcome" = 'EXCLUDED' AND NEW."exclusion_reason" IS NULL)
  OR (NEW."domain_score" IS NOT NULL AND (NEW."domain_score" < 0 OR NEW."domain_score" > 100))
  OR (NEW."scoring_state" IS NOT NULL AND NEW."scoring_state" NOT IN ('SCORED', 'UNSCORED', 'NOT_RANKABLE'))
  OR (NEW."published_scoring_state" IS NOT NULL AND NEW."published_scoring_state" NOT IN ('SCORED', 'UNSCORED', 'NOT_RANKABLE'))
  OR (NEW."outcome" = 'RANKED' AND NEW."scoring_state" IS NOT NULL AND NEW."scoring_state" <> 'SCORED')
  OR (NEW."outcome" = 'EXCLUDED' AND NEW."scoring_state" IS NOT NULL AND NEW."scoring_state" = 'SCORED')
  OR (NEW."scoring_state" IN ('UNSCORED', 'NOT_RANKABLE') AND (NEW."scoring_state_reason" IS NULL OR length(trim(NEW."scoring_state_reason")) = 0))
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_SCORING_VOCABULARY'); END;
CREATE TRIGGER "iam_core_priority_governance_vocab_insert" BEFORE INSERT ON "iam_core_priority_governance"
WHEN NEW."action_type" NOT IN ('PRIORITY_OVERRIDE', 'OVERRIDE_REVOKED', 'RANK_LOCK', 'RANK_UNLOCK', 'MANUAL_TIEBREAK', 'STRATEGIC_AUTHORIZED', 'STRATEGIC_REVOKED', 'EMERGENCY_CONFIRMED', 'EMERGENCY_DECLINED', 'EMERGENCY_CLEARED', 'DATA_INVESTIGATION_ROUTED', 'FORCED_REVIEW_RESOLVED')
  OR length(trim(NEW."actor_id")) = 0
  OR length(trim(NEW."reason")) = 0
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_GOVERNANCE_VOCABULARY'); END;
CREATE TRIGGER "iam_core_forced_reviews_vocab_insert" BEFORE INSERT ON "iam_core_forced_reviews"
WHEN NEW."reason_code" NOT IN ('CRITICAL_OUTSIDE_TOP2', 'REPEATED_REJECTION', 'ADDITIONAL_EMERGENCY', 'SUPPRESSION_RE_REVIEW', 'DATA_INVESTIGATION', 'POSSIBLE_DOUBLE_COUNTING')
  OR NEW."status" NOT IN ('OPEN', 'RESOLVED')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_SCORING_VOCABULARY'); END;
CREATE TRIGGER "iam_core_forced_reviews_vocab_update" BEFORE UPDATE ON "iam_core_forced_reviews"
WHEN NEW."status" NOT IN ('OPEN', 'RESOLVED')
  OR (OLD."status" = 'RESOLVED' AND NEW."status" <> 'RESOLVED')
  OR (NEW."status" = 'RESOLVED' AND (NEW."resolved_by" IS NULL OR NEW."resolved_at" IS NULL OR NEW."resolution" IS NULL OR NEW."resolution_basis" IS NULL))
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_SCORING_VOCABULARY'); END;
CREATE TRIGGER "iam_core_emergency_reviews_vocab_insert" BEFORE INSERT ON "iam_core_emergency_reviews"
WHEN NEW."status" NOT IN ('CANDIDATE', 'CONFIRMED', 'DECLINED', 'WITHDRAWN', 'CLEARED')
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_SCORING_VOCABULARY'); END;
-- An emergency is never automatic: CONFIRMED / DECLINED / CLEARED must carry the deciding user id and a reason.
CREATE TRIGGER "iam_core_emergency_reviews_vocab_update" BEFORE UPDATE ON "iam_core_emergency_reviews"
WHEN NEW."status" NOT IN ('CANDIDATE', 'CONFIRMED', 'DECLINED', 'WITHDRAWN', 'CLEARED')
  OR (NEW."status" IN ('CONFIRMED', 'DECLINED', 'CLEARED') AND (NEW."decided_by" IS NULL OR length(trim(NEW."decided_by")) = 0 OR NEW."decision_reason" IS NULL OR length(trim(NEW."decision_reason")) = 0))
  OR (OLD."status" IN ('DECLINED', 'WITHDRAWN', 'CLEARED') AND NEW."status" <> OLD."status")
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_SCORING_VOCABULARY'); END;

-- Closed candidates are never reopened: no further scoring facts, results, governance or reviews for them.
CREATE TRIGGER "iam_core_scoring_inputs_closed_no_insert" BEFORE INSERT ON "iam_core_scoring_inputs"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_display_changes_closed_no_insert" BEFORE INSERT ON "iam_core_display_changes"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;
CREATE TRIGGER "iam_core_priority_governance_closed_no_insert" BEFORE INSERT ON "iam_core_priority_governance"
WHEN (SELECT "closed_at" FROM "iam_core_candidates" WHERE "candidate_id" = NEW."candidate_id") IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'IAM_CORE_CLOSED_CANDIDATE_NO_REOPEN'); END;