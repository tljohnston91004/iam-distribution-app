-- Stage 4B reversal: removes ONLY the objects created by migration 20261021140000_stage4b_workflow.
-- No V1.5 table, no Stage 4A table, column, index or row is touched. Run through scripts/iam-migrate.ts rollback-4b
-- (which backs the database up first and refuses to discard workflow data unless explicitly told to).

-- Triggers (drop first: they reference the tables below).
DROP TRIGGER IF EXISTS "iam_core_workflow_states_vocab_update";
DROP TRIGGER IF EXISTS "iam_core_workflow_states_vocab_insert";
DROP TRIGGER IF EXISTS "iam_core_workflow_states_no_delete";
DROP TRIGGER IF EXISTS "iam_core_workflow_states_closed_no_update";
DROP TRIGGER IF EXISTS "iam_core_workflow_history_no_update";
DROP TRIGGER IF EXISTS "iam_core_workflow_history_no_delete";
DROP TRIGGER IF EXISTS "iam_core_workflow_history_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_suppressions_no_delete";
DROP TRIGGER IF EXISTS "iam_core_suppressions_closed_no_update";
DROP TRIGGER IF EXISTS "iam_core_suppressions_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_progress_updates_no_update";
DROP TRIGGER IF EXISTS "iam_core_progress_updates_no_delete";
DROP TRIGGER IF EXISTS "iam_core_progress_updates_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_pause_requests_no_delete";
DROP TRIGGER IF EXISTS "iam_core_pause_requests_closed_no_update";
DROP TRIGGER IF EXISTS "iam_core_pause_requests_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_management_decisions_no_update";
DROP TRIGGER IF EXISTS "iam_core_management_decisions_no_delete";
DROP TRIGGER IF EXISTS "iam_core_management_decisions_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_decision_required_no_delete";
DROP TRIGGER IF EXISTS "iam_core_decision_required_closed_no_update";
DROP TRIGGER IF EXISTS "iam_core_decision_required_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_contributor_authorizations_no_delete";
DROP TRIGGER IF EXISTS "iam_core_contributor_authorizations_closed_no_update";
DROP TRIGGER IF EXISTS "iam_core_contributor_authorizations_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_candidate_evidence_no_update";
DROP TRIGGER IF EXISTS "iam_core_candidate_evidence_no_delete";
DROP TRIGGER IF EXISTS "iam_core_candidate_evidence_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_blockers_no_delete";
DROP TRIGGER IF EXISTS "iam_core_blockers_closed_no_update";
DROP TRIGGER IF EXISTS "iam_core_blockers_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_assignment_events_no_update";
DROP TRIGGER IF EXISTS "iam_core_assignment_events_no_delete";
DROP TRIGGER IF EXISTS "iam_core_assignment_events_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_action_tracking_vocab_update";
DROP TRIGGER IF EXISTS "iam_core_action_tracking_vocab_insert";
DROP TRIGGER IF EXISTS "iam_core_action_tracking_no_delete";
DROP TRIGGER IF EXISTS "iam_core_action_tracking_closed_no_update";
DROP TRIGGER IF EXISTS "iam_core_action_tracking_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_action_status_history_no_update";
DROP TRIGGER IF EXISTS "iam_core_action_status_history_no_delete";
DROP TRIGGER IF EXISTS "iam_core_action_status_history_closed_no_insert";

-- Indexes.
DROP INDEX IF EXISTS "iam_core_workflow_states_dpos_company_id_workflow_state_idx";
DROP INDEX IF EXISTS "iam_core_workflow_states_dpos_company_id_grouped_condition_key_idx";
DROP INDEX IF EXISTS "iam_core_workflow_history_candidate_id_at_idx";
DROP INDEX IF EXISTS "iam_core_management_decisions_candidate_id_decided_at_idx";
DROP INDEX IF EXISTS "iam_core_management_decisions_dpos_company_id_grouped_condition_key_decision_type_idx";
DROP INDEX IF EXISTS "iam_core_suppressions_candidate_id_status_idx";
DROP INDEX IF EXISTS "iam_core_candidate_evidence_candidate_id_evidence_ref_key";
DROP INDEX IF EXISTS "iam_core_assignment_events_candidate_id_at_idx";
DROP INDEX IF EXISTS "iam_core_action_tracking_dpos_company_id_action_status_idx";
DROP INDEX IF EXISTS "iam_core_progress_updates_candidate_id_at_idx";
DROP INDEX IF EXISTS "iam_core_action_status_history_candidate_id_at_idx";
DROP INDEX IF EXISTS "iam_core_decision_required_candidate_id_status_idx";
DROP INDEX IF EXISTS "iam_core_decision_required_dpos_company_id_status_idx";
DROP INDEX IF EXISTS "iam_core_pause_requests_candidate_id_status_idx";
DROP INDEX IF EXISTS "iam_core_blockers_candidate_id_status_idx";
DROP INDEX IF EXISTS "iam_core_contributor_authorizations_candidate_id_user_id_idx";
DROP INDEX IF EXISTS "iam_core_suppressions_one_active";
DROP INDEX IF EXISTS "iam_core_decision_required_one_open";
DROP INDEX IF EXISTS "iam_core_pause_requests_one_live";
DROP INDEX IF EXISTS "iam_core_blockers_one_open";
DROP INDEX IF EXISTS "iam_core_contributor_authorizations_one_live";

-- Tables.
DROP TABLE IF EXISTS "iam_core_contributor_authorizations";
DROP TABLE IF EXISTS "iam_core_blockers";
DROP TABLE IF EXISTS "iam_core_pause_requests";
DROP TABLE IF EXISTS "iam_core_decision_required";
DROP TABLE IF EXISTS "iam_core_action_status_history";
DROP TABLE IF EXISTS "iam_core_progress_updates";
DROP TABLE IF EXISTS "iam_core_action_tracking";
DROP TABLE IF EXISTS "iam_core_assignment_events";
DROP TABLE IF EXISTS "iam_core_candidate_evidence";
DROP TABLE IF EXISTS "iam_core_suppressions";
DROP TABLE IF EXISTS "iam_core_management_decisions";
DROP TABLE IF EXISTS "iam_core_workflow_history";
DROP TABLE IF EXISTS "iam_core_workflow_states";
