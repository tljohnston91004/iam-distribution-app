-- Stage 4D: Inventory Management Health Score history, governed health evidence and board review marks.
-- ADDITIVE ONLY: creates new tables/indexes/triggers. No V1.5, Stage 4A, Stage 4B or Stage 4C table is altered, dropped or
-- repurposed. Reverse with down.sql via scripts/iam-migrate.ts rollback-4d (backup first; refuses to discard health data
-- unless explicitly told to).

-- CreateTable
CREATE TABLE "iam_core_health_evidence" (
    "evidence_id" TEXT NOT NULL PRIMARY KEY,
    "dpos_company_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "evidence_version" INTEGER NOT NULL,
    "evidence_json" TEXT NOT NULL,
    "evidence_hash" TEXT NOT NULL,
    "source_refs_json" TEXT NOT NULL,
    "as_of" DATETIME,
    "recorded_by" TEXT NOT NULL,
    "recorded_by_role" TEXT NOT NULL,
    "recorded_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "iam_core_health_scores" (
    "health_score_id" TEXT NOT NULL PRIMARY KEY,
    "dpos_company_id" TEXT NOT NULL,
    "health_version" TEXT NOT NULL,
    "curve_status" TEXT NOT NULL,
    "config_hash" TEXT NOT NULL,
    "calc_key" TEXT,
    "operating_week_start" TEXT NOT NULL,
    "company_time_zone" TEXT,
    "calculated_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "score" REAL,
    "label" TEXT,
    "available_components" INTEGER NOT NULL,
    "components_json" TEXT NOT NULL,
    "source_refs_json" TEXT NOT NULL,
    "data_current_through" DATETIME,
    "requested_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "iam_core_board_reviews" (
    "review_id" TEXT NOT NULL PRIMARY KEY,
    "dpos_company_id" TEXT NOT NULL,
    "reviewed_at" DATETIME NOT NULL,
    "reviewed_by" TEXT NOT NULL,
    "reviewed_by_role" TEXT NOT NULL,
    "operating_week_start" TEXT NOT NULL,
    "health_score_id" TEXT,
    "note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "iam_core_health_evidence_dpos_company_id_kind_recorded_at_idx" ON "iam_core_health_evidence"("dpos_company_id", "kind", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "iam_core_health_evidence_dpos_company_id_kind_evidence_version_key" ON "iam_core_health_evidence"("dpos_company_id", "kind", "evidence_version");

-- CreateIndex
CREATE INDEX "iam_core_health_scores_dpos_company_id_calculated_at_idx" ON "iam_core_health_scores"("dpos_company_id", "calculated_at");

-- CreateIndex
CREATE INDEX "iam_core_health_scores_dpos_company_id_operating_week_start_idx" ON "iam_core_health_scores"("dpos_company_id", "operating_week_start");

-- CreateIndex
CREATE UNIQUE INDEX "iam_core_health_scores_dpos_company_id_calc_key_key" ON "iam_core_health_scores"("dpos_company_id", "calc_key");

-- CreateIndex
CREATE INDEX "iam_core_board_reviews_dpos_company_id_reviewed_at_idx" ON "iam_core_board_reviews"("dpos_company_id", "reviewed_at");

-- ---------------------------------------------------------------------------------------------------------------------
-- Governance: every Stage 4D table is an append-only ledger (no update, no delete) and carries a closed vocabulary.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TRIGGER "iam_core_health_evidence_no_update" BEFORE UPDATE ON "iam_core_health_evidence" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_health_evidence_no_delete" BEFORE DELETE ON "iam_core_health_evidence" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_health_scores_no_update" BEFORE UPDATE ON "iam_core_health_scores" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_health_scores_no_delete" BEFORE DELETE ON "iam_core_health_scores" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_board_reviews_no_update" BEFORE UPDATE ON "iam_core_board_reviews" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER "iam_core_board_reviews_no_delete" BEFORE DELETE ON "iam_core_board_reviews" BEGIN SELECT RAISE(ABORT, 'IAM_CORE_LEDGER_APPEND_ONLY'); END;

CREATE TRIGGER "iam_core_health_evidence_vocab_insert" BEFORE INSERT ON "iam_core_health_evidence"
WHEN NEW."kind" NOT IN ('POSITION_BALANCE', 'EFFICIENCY', 'SLOW_NONMOVING', 'COMPANY_FACTS')
BEGIN SELECT RAISE(ABORT, 'IAM_HEALTH_VOCABULARY'); END;

CREATE TRIGGER "iam_core_health_scores_vocab_insert" BEFORE INSERT ON "iam_core_health_scores"
WHEN NEW."status" NOT IN ('CALCULATED', 'NO_COMPONENT_AVAILABLE')
  OR NEW."curve_status" NOT IN ('PROVISIONAL', 'APPROVED')
  OR (NEW."label" IS NOT NULL AND NEW."label" NOT IN ('STRONG', 'HEALTHY', 'WATCH', 'NEEDS_ATTENTION'))
  OR (NEW."status" = 'CALCULATED' AND (NEW."score" IS NULL OR NEW."label" IS NULL))
  OR (NEW."status" = 'NO_COMPONENT_AVAILABLE' AND (NEW."score" IS NOT NULL OR NEW."label" IS NOT NULL))
  OR (NEW."score" IS NOT NULL AND (NEW."score" < 0 OR NEW."score" > 100))
BEGIN SELECT RAISE(ABORT, 'IAM_HEALTH_VOCABULARY'); END;
