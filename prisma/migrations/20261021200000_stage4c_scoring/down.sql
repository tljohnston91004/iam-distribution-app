-- Stage 4C reversal: removes ONLY the objects created by migration 20261021200000_stage4c_scoring.
-- No V1.5 table, no Stage 4A table and no Stage 4B table, column, index or row is touched. Run through
-- scripts/iam-migrate.ts rollback-4c (which backs the database up first and refuses to discard scoring data unless
-- explicitly told to).

-- Triggers (drop first: they reference the tables below).
DROP TRIGGER IF EXISTS "iam_core_display_changes_no_update";
DROP TRIGGER IF EXISTS "iam_core_display_changes_no_delete";
DROP TRIGGER IF EXISTS "iam_core_display_changes_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_scoring_inputs_no_update";
DROP TRIGGER IF EXISTS "iam_core_scoring_inputs_no_delete";
DROP TRIGGER IF EXISTS "iam_core_scoring_inputs_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_scoring_runs_no_update";
DROP TRIGGER IF EXISTS "iam_core_scoring_runs_no_delete";
DROP TRIGGER IF EXISTS "iam_core_scoring_runs_vocab_insert";
DROP TRIGGER IF EXISTS "iam_core_score_results_no_update";
DROP TRIGGER IF EXISTS "iam_core_score_results_no_delete";
DROP TRIGGER IF EXISTS "iam_core_score_results_vocab_insert";
DROP TRIGGER IF EXISTS "iam_core_priority_governance_no_update";
DROP TRIGGER IF EXISTS "iam_core_priority_governance_no_delete";
DROP TRIGGER IF EXISTS "iam_core_priority_governance_vocab_insert";
DROP TRIGGER IF EXISTS "iam_core_priority_governance_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_forced_reviews_no_delete";
DROP TRIGGER IF EXISTS "iam_core_forced_reviews_vocab_insert";
DROP TRIGGER IF EXISTS "iam_core_forced_reviews_vocab_update";
DROP TRIGGER IF EXISTS "iam_core_emergency_reviews_no_delete";
DROP TRIGGER IF EXISTS "iam_core_emergency_reviews_vocab_insert";
DROP TRIGGER IF EXISTS "iam_core_emergency_reviews_vocab_update";

-- Tables (children first).
DROP TABLE IF EXISTS "iam_core_display_changes";
DROP TABLE IF EXISTS "iam_core_emergency_reviews";
DROP TABLE IF EXISTS "iam_core_forced_reviews";
DROP TABLE IF EXISTS "iam_core_priority_governance";
DROP TABLE IF EXISTS "iam_core_score_results";
DROP TABLE IF EXISTS "iam_core_scoring_runs";
DROP TABLE IF EXISTS "iam_core_scoring_inputs";