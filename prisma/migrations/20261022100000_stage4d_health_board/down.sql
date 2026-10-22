-- Stage 4D reversal: removes ONLY the objects created by migration 20261022100000_stage4d_health_board.
-- No V1.5, Stage 4A, Stage 4B or Stage 4C table, column, index or row is touched. Run through scripts/iam-migrate.ts rollback-4d
-- (which backs the database up first and refuses to discard health data unless explicitly told to).

DROP TRIGGER IF EXISTS "iam_core_health_evidence_no_update";
DROP TRIGGER IF EXISTS "iam_core_health_evidence_no_delete";
DROP TRIGGER IF EXISTS "iam_core_health_evidence_vocab_insert";
DROP TRIGGER IF EXISTS "iam_core_health_scores_no_update";
DROP TRIGGER IF EXISTS "iam_core_health_scores_no_delete";
DROP TRIGGER IF EXISTS "iam_core_health_scores_vocab_insert";
DROP TRIGGER IF EXISTS "iam_core_board_reviews_no_update";
DROP TRIGGER IF EXISTS "iam_core_board_reviews_no_delete";

DROP TABLE IF EXISTS "iam_core_board_reviews";
DROP TABLE IF EXISTS "iam_core_health_scores";
DROP TABLE IF EXISTS "iam_core_health_evidence";
