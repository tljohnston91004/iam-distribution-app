-- Stage 4A reversal: removes ONLY the objects created by migration 20261021100000_stage4a_core_integration_foundation.
-- No V1.5 table, column, index or row is touched. Run through scripts/iam-migrate.ts (which backs the database up first
-- and refuses to discard integration data unless explicitly told to). Not applied automatically by Prisma.

-- Triggers (drop first: they reference the tables below).
DROP TRIGGER IF EXISTS "dpos_audit_events_no_delete";
DROP TRIGGER IF EXISTS "dpos_audit_events_no_update";
DROP TRIGGER IF EXISTS "dpos_results_return_outbox_attempts_no_delete";
DROP TRIGGER IF EXISTS "dpos_results_return_outbox_attempts_no_update";
DROP TRIGGER IF EXISTS "dpos_results_return_outbox_synced_final";
DROP TRIGGER IF EXISTS "dpos_results_return_outbox_identity_immutable";
DROP TRIGGER IF EXISTS "dpos_results_return_outbox_no_delete";
DROP TRIGGER IF EXISTS "iam_core_outcomes_no_delete";
DROP TRIGGER IF EXISTS "iam_core_outcomes_closed_immutable";
DROP TRIGGER IF EXISTS "iam_core_execution_states_closed_no_update";
DROP TRIGGER IF EXISTS "iam_core_execution_states_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_ownerships_closed_no_update";
DROP TRIGGER IF EXISTS "iam_core_ownerships_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_management_plans_closed_no_update";
DROP TRIGGER IF EXISTS "iam_core_management_plans_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_system_recommendations_closed_no_insert";
DROP TRIGGER IF EXISTS "iam_core_system_recommendations_no_delete";
DROP TRIGGER IF EXISTS "iam_core_system_recommendations_no_update";
DROP TRIGGER IF EXISTS "iam_core_candidates_identity_immutable";
DROP TRIGGER IF EXISTS "iam_core_candidates_closed_no_reopen";
DROP TRIGGER IF EXISTS "iam_core_candidates_no_delete";
DROP INDEX IF EXISTS "iam_core_candidates_one_open_per_condition";

-- Tables (children before parents).
DROP TABLE IF EXISTS "iam_core_contributors";
DROP TABLE IF EXISTS "iam_core_ownerships";
DROP TABLE IF EXISTS "iam_core_outcomes";
DROP TABLE IF EXISTS "iam_core_execution_states";
DROP TABLE IF EXISTS "iam_core_management_plans";
DROP TABLE IF EXISTS "iam_core_system_recommendations";
DROP TABLE IF EXISTS "iam_core_candidates";
DROP TABLE IF EXISTS "dpos_results_return_outbox_attempts";
DROP TABLE IF EXISTS "dpos_results_return_outbox";
DROP TABLE IF EXISTS "dpos_refresh_state";
DROP TABLE IF EXISTS "dpos_refresh_attempts";
DROP TABLE IF EXISTS "dpos_audit_events";
DROP TABLE IF EXISTS "dpos_service_identities";
DROP TABLE IF EXISTS "dpos_company_bindings";
DROP TABLE IF EXISTS "dpos_migration_records";
