-- Stage 4E reversal: removes ONLY the objects created by migration 20261023100000_stage4e_closeout_learning.
-- No V1.5, Stage 4A, Stage 4B, Stage 4C or Stage 4D table, column, index or row is touched. Run through scripts/iam-migrate.ts rollback-4e
-- (which backs the database up first and refuses to discard closeout / learning data unless explicitly told to).

DROP TRIGGER IF EXISTS "iam_core_closeouts_no_delete";
DROP TRIGGER IF EXISTS "iam_core_closeouts_closed_immutable";
DROP TRIGGER IF EXISTS "iam_core_closeouts_identity_immutable";
DROP TRIGGER IF EXISTS "iam_core_closeouts_vocab_insert";
DROP TRIGGER IF EXISTS "iam_core_closeouts_vocab_update";
DROP TRIGGER IF EXISTS "iam_core_closeouts_final_vocab_update";
DROP TRIGGER IF EXISTS "iam_core_closeouts_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_closeout_versions_no_update";
DROP TRIGGER IF EXISTS "iam_core_closeout_versions_no_delete";
DROP TRIGGER IF EXISTS "iam_core_closeout_approvals_no_update";
DROP TRIGGER IF EXISTS "iam_core_closeout_approvals_no_delete";
DROP TRIGGER IF EXISTS "iam_core_closeout_history_no_update";
DROP TRIGGER IF EXISTS "iam_core_closeout_history_no_delete";
DROP TRIGGER IF EXISTS "iam_core_learning_records_no_update";
DROP TRIGGER IF EXISTS "iam_core_learning_records_no_delete";
DROP TRIGGER IF EXISTS "iam_core_recurrence_links_no_update";
DROP TRIGGER IF EXISTS "iam_core_recurrence_links_no_delete";
DROP TRIGGER IF EXISTS "iam_core_closeout_versions_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_closeout_approvals_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_closeout_history_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_learning_records_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_closeout_versions_vocab_assessed_status_insert";
DROP TRIGGER IF EXISTS "iam_core_closeout_versions_vocab_recommended_status_insert";
DROP TRIGGER IF EXISTS "iam_core_closeout_versions_vocab_attribution_category_insert";
DROP TRIGGER IF EXISTS "iam_core_closeout_versions_vocab_attribution_confidence_insert";
DROP TRIGGER IF EXISTS "iam_core_closeout_versions_vocab_outcome_confidence_insert";
DROP TRIGGER IF EXISTS "iam_core_closeout_versions_vocab_recurrence_risk_insert";
DROP TRIGGER IF EXISTS "iam_core_closeout_versions_vocab_condition_reduction_state_insert";
DROP TRIGGER IF EXISTS "iam_core_closeout_versions_vocab_assessment_kind_insert";
DROP TRIGGER IF EXISTS "iam_core_closeout_approvals_vocab_final_status_insert";
DROP TRIGGER IF EXISTS "iam_core_learning_records_vocab_management_response_insert";
DROP TRIGGER IF EXISTS "iam_core_learning_records_vocab_attribution_category_insert";
DROP TRIGGER IF EXISTS "iam_core_recurrence_links_vocab_match_status_insert";
DROP TRIGGER IF EXISTS "iam_core_recurrence_links_vocab_match_basis_insert";

DROP TRIGGER IF EXISTS "iam_core_condition_classifications_no_update";
DROP TRIGGER IF EXISTS "iam_core_condition_classifications_no_delete";
DROP TRIGGER IF EXISTS "iam_core_condition_classifications_source_vocab_insert";

DROP TABLE IF EXISTS "iam_core_condition_classifications";
DROP TABLE IF EXISTS "iam_core_recurrence_links";
DROP TABLE IF EXISTS "iam_core_learning_records";
DROP TABLE IF EXISTS "iam_core_closeout_approvals";
DROP TABLE IF EXISTS "iam_core_closeout_history";
DROP TABLE IF EXISTS "iam_core_closeout_versions";
DROP TABLE IF EXISTS "iam_core_closeouts";
