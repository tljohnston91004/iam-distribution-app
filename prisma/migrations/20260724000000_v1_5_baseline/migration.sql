-- CreateTable
CREATE TABLE "companies" (
    "company_id" TEXT NOT NULL PRIMARY KEY,
    "company_name" TEXT NOT NULL,
    "business_type" TEXT,
    "pos_system" TEXT,
    "active_status" BOOLEAN NOT NULL DEFAULT true,
    "organizational_execution_capability" INTEGER NOT NULL DEFAULT 2,
    "recommendation_aging_days" INTEGER NOT NULL DEFAULT 14,
    "enable_standalone_upload" BOOLEAN NOT NULL DEFAULT true,
    "enable_rse_evidence" BOOLEAN NOT NULL DEFAULT false,
    "enable_data_hub" BOOLEAN NOT NULL DEFAULT false,
    "trailing_52_week_revenue" REAL,
    "trailing_12_month_gross_profit" REAL,
    "total_inventory_book_value" REAL,
    "annual_carrying_cost_rate" REAL,
    "carrying_cost_rate_effective_date" DATETIME,
    "carrying_cost_rate_source" TEXT,
    "carrying_cost_rate_note" TEXT,
    "carrying_cost_rate_permission" TEXT,
    "carrying_cost_rate_updated_by" TEXT,
    "carrying_cost_rate_updated_at" DATETIME,
    "carrying_cost_rate_max_allowed" REAL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "company_configuration_changes" (
    "company_configuration_change_id" TEXT NOT NULL PRIMARY KEY,
    "company_id" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "performed_by" TEXT NOT NULL,
    "performed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "before_json" TEXT,
    "after_json" TEXT,
    "detail" TEXT,
    CONSTRAINT "company_configuration_changes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("company_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "iam_runs" (
    "iam_run_id" TEXT NOT NULL PRIMARY KEY,
    "company_id" TEXT NOT NULL,
    "run_name" TEXT NOT NULL,
    "review_date" DATETIME NOT NULL,
    "review_week_start" DATETIME NOT NULL,
    "review_week_end" DATETIME NOT NULL,
    "review_cadence" TEXT NOT NULL DEFAULT 'weekly',
    "run_status" TEXT NOT NULL DEFAULT 'Draft',
    "cycle_status" TEXT NOT NULL DEFAULT 'Open',
    "cycle_locked_at" DATETIME,
    "cycle_locked_by" TEXT,
    "readiness_status" TEXT NOT NULL DEFAULT 'Not Ready',
    "evidence_approval_status" TEXT NOT NULL DEFAULT 'draft',
    "evidence_approved_at" DATETIME,
    "evidence_approved_by" TEXT,
    "run_version" INTEGER NOT NULL DEFAULT 1,
    "parent_run_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL DEFAULT 'pilot-user',
    CONSTRAINT "iam_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("company_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "source_documents" (
    "source_document_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "source_system_name" TEXT NOT NULL,
    "source_document_name" TEXT NOT NULL,
    "source_area_or_section" TEXT,
    "source_report_date" DATETIME,
    "freshness_status" TEXT NOT NULL DEFAULT 'Unknown',
    "confidence_level" TEXT NOT NULL DEFAULT 'Medium Confidence',
    "uploaded_or_entered_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "source_documents_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "field_mappings" (
    "field_mapping_id" TEXT NOT NULL PRIMARY KEY,
    "source_document_id" TEXT NOT NULL,
    "source_field_name" TEXT NOT NULL,
    "iam_domain" TEXT NOT NULL,
    "iam_table" TEXT NOT NULL,
    "iam_field_name" TEXT NOT NULL,
    "mapping_confidence" TEXT NOT NULL DEFAULT 'Medium Confidence',
    "validation_status" TEXT NOT NULL DEFAULT 'needs review',
    CONSTRAINT "field_mappings_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "source_documents" ("source_document_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "inventory_snapshots" (
    "inventory_snapshot_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "sku_or_item_id" TEXT NOT NULL,
    "description" TEXT,
    "quantity_on_hand" REAL NOT NULL,
    "available_qoh" REAL,
    "quantity_basis_used" TEXT,
    "cost" REAL,
    "inventory_value" REAL,
    "classification" TEXT,
    "item_status" TEXT,
    "vendor_name" TEXT,
    "category" TEXT,
    "department" TEXT,
    "location_code" TEXT,
    "product_group" TEXT,
    "classification_source" TEXT,
    "data_confidence" TEXT NOT NULL DEFAULT 'Medium Confidence',
    "entity_eligibility" TEXT NOT NULL DEFAULT 'rankable',
    "selected_for_analysis" BOOLEAN NOT NULL DEFAULT true,
    "winning_source_system" TEXT,
    "evidence_batch_id" TEXT,
    "open_order_quantity" REAL,
    "last_sold_date" DATETIME,
    "last_received_date" DATETIME,
    "source_row_ref" TEXT,
    CONSTRAINT "inventory_snapshots_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inventory_snapshots_evidence_batch_id_fkey" FOREIGN KEY ("evidence_batch_id") REFERENCES "evidence_batches" ("evidence_batch_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "demand_history" (
    "demand_history_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "sku_or_item_id" TEXT NOT NULL,
    "period_label" TEXT NOT NULL,
    "period_code" TEXT,
    "units_sold" REAL NOT NULL,
    "gross_sales_dollars" REAL NOT NULL,
    "returns_or_negative_movement" REAL,
    "data_confidence" TEXT NOT NULL DEFAULT 'Medium Confidence',
    "entity_eligibility" TEXT NOT NULL DEFAULT 'rankable',
    "selected_for_analysis" BOOLEAN NOT NULL DEFAULT true,
    "winning_source_system" TEXT,
    "evidence_batch_id" TEXT,
    "source_row_ref" TEXT,
    CONSTRAINT "demand_history_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "demand_history_evidence_batch_id_fkey" FOREIGN KEY ("evidence_batch_id") REFERENCES "evidence_batches" ("evidence_batch_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "receipt_history_summary" (
    "receipt_history_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "sku_or_item_id" TEXT NOT NULL,
    "first_purchase_date" DATETIME,
    "last_receipt_date" DATETIME,
    "last_receipt_quantity" REAL,
    "receipt_count_lookback" INTEGER,
    "received_qty_lookback" REAL,
    CONSTRAINT "receipt_history_summary_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "incoming_supply" (
    "incoming_supply_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "sku_or_item_id" TEXT NOT NULL,
    "open_order_quantity" REAL,
    "expected_receipt_date" DATETIME,
    "backorder_quantity" REAL,
    "data_confidence" TEXT NOT NULL DEFAULT 'Medium Confidence',
    "evidence_batch_id" TEXT,
    CONSTRAINT "incoming_supply_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "incoming_supply_evidence_batch_id_fkey" FOREIGN KEY ("evidence_batch_id") REFERENCES "evidence_batches" ("evidence_batch_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "evidence_batches" (
    "evidence_batch_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "external_batch_key" TEXT NOT NULL,
    "source_system" TEXT NOT NULL,
    "source_report_type" TEXT NOT NULL,
    "as_of_timestamp" DATETIME,
    "content_identity" TEXT,
    "source_file_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "error_detail" TEXT,
    "source_channel" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evidence_batches_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "evidence_conflicts" (
    "evidence_conflict_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "sku_or_item_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "winning_source" TEXT NOT NULL,
    "losing_source" TEXT NOT NULL,
    "winning_value" TEXT,
    "losing_value" TEXT,
    "resolution_rule" TEXT NOT NULL,
    "detail_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evidence_conflicts_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "recommendations" (
    "recommendation_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "source_module" TEXT NOT NULL,
    "source_recommendation_id" TEXT,
    "generation_path" TEXT NOT NULL DEFAULT 'module',
    "opportunity_key" TEXT NOT NULL,
    "sku_or_item_id" TEXT,
    "analysis_grain" TEXT NOT NULL DEFAULT 'sku',
    "segment_type" TEXT,
    "segment_key" TEXT,
    "affected_sku_count" INTEGER,
    "recommendation_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lifecycle_state" TEXT NOT NULL DEFAULT 'Identified',
    "presentation_category" TEXT NOT NULL DEFAULT 'managed_backlog',
    "presentation_rank" INTEGER,
    "confidence" TEXT NOT NULL DEFAULT 'Medium',
    "estimated_financial_impact" REAL,
    "estimated_cash_impact" REAL,
    "cost_of_inaction" REAL,
    "coi_horizon_value" REAL,
    "coi_horizon_unit" TEXT,
    "coi_horizon_days" INTEGER,
    "coi_horizon_source" TEXT,
    "recommended_target_period" TEXT,
    "recommended_target_end_date" DATETIME,
    "management_adjusted_target_period" TEXT,
    "management_adjustment_reason" TEXT,
    "management_adjusted_by" TEXT,
    "management_adjusted_at" DATETIME,
    "affected_inventory_value_for_coi" REAL,
    "annual_carrying_cost_rate_used" REAL,
    "carrying_cost_component" REAL,
    "preventable_loss_component" REAL,
    "other_coi_component" REAL,
    "coi_confidence_level" TEXT,
    "coi_calculation_status" TEXT,
    "coi_calculation_explanation" TEXT,
    "coi_board_display_line" TEXT,
    "original_estimated_coi" REAL,
    "revised_estimated_coi" REAL,
    "coi_detail_json" TEXT,
    "priority_score" REAL,
    "scoring_profile_id" TEXT,
    "story_what" TEXT,
    "story_why" TEXT,
    "story_why_now" TEXT,
    "story_expected_result" TEXT,
    "confidence_narrative" TEXT,
    "progress_narrative" TEXT,
    "blocker_note" TEXT,
    "last_progress_at" DATETIME,
    "expected_completion_at" DATETIME,
    "explainability_json" TEXT,
    "evidence_refs_json" TEXT,
    "source_payload_hash" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "recommendations_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "recommendation_assignments" (
    "assignment_id" TEXT NOT NULL PRIMARY KEY,
    "recommendation_id" TEXT NOT NULL,
    "primary_owner_user_id" TEXT NOT NULL,
    "primary_owner_name" TEXT,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "progress_percent" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "recommendation_assignments_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendations" ("recommendation_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "recommendation_contributors" (
    "contributor_id" TEXT NOT NULL PRIMARY KEY,
    "recommendation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recommendation_contributors_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendations" ("recommendation_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "recommendation_assignment_history" (
    "assignment_history_id" TEXT NOT NULL PRIMARY KEY,
    "recommendation_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "primary_owner_user_id" TEXT,
    "primary_owner_name" TEXT,
    "performed_by" TEXT NOT NULL,
    "detail_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recommendation_assignment_history_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendations" ("recommendation_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "recommendation_notes" (
    "note_id" TEXT NOT NULL PRIMARY KEY,
    "recommendation_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'shared',
    "authored_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recommendation_notes_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendations" ("recommendation_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "financial_impacts" (
    "impact_id" TEXT NOT NULL PRIMARY KEY,
    "recommendation_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "expected_value" REAL NOT NULL,
    "expected_cash" REAL,
    "net_scoreable_13_week_cash" REAL,
    "net_scoreable_profitability" REAL,
    "estimation_method" TEXT,
    "impact_period" TEXT,
    "actual_value" REAL,
    "actual_cash" REAL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "measurable" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_impacts_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendations" ("recommendation_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "governance_decisions" (
    "governance_decision_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "recommendation_id" TEXT,
    "decision_type" TEXT NOT NULL,
    "reason" TEXT,
    "performed_by" TEXT NOT NULL,
    "performed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail_json" TEXT,
    CONSTRAINT "governance_decisions_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "governance_decisions_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendations" ("recommendation_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "workflow_events" (
    "workflow_event_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "recommendation_id" TEXT,
    "from_state" TEXT NOT NULL,
    "to_state" TEXT NOT NULL,
    "performed_by" TEXT NOT NULL,
    "event_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    CONSTRAINT "workflow_events_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workflow_events_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendations" ("recommendation_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_events" (
    "audit_event_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "performed_by" TEXT NOT NULL,
    "performed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail_json" TEXT,
    "request_id" TEXT,
    CONSTRAINT "audit_events_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "action_candidates" (
    "action_candidate_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "sku_or_item_id" TEXT,
    "source_type" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "candidate_title" TEXT NOT NULL,
    "evidence_strength" TEXT NOT NULL,
    "estimated_cash_impact" REAL,
    "service_operational_risk_flag" BOOLEAN NOT NULL DEFAULT false,
    "service_risk_score" REAL NOT NULL DEFAULT 0,
    "cash_impact_score" REAL NOT NULL DEFAULT 0,
    "priority_score" REAL NOT NULL DEFAULT 0,
    "priority_category" TEXT NOT NULL DEFAULT 'new_priority',
    "readiness_label" TEXT NOT NULL DEFAULT 'Ready with Limitations',
    "management_priority_flag" BOOLEAN NOT NULL DEFAULT false,
    "confidence_level" TEXT NOT NULL DEFAULT 'Medium Confidence',
    "suppressed_flag" BOOLEAN NOT NULL DEFAULT false,
    "ranked_position" INTEGER,
    "detail_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "action_candidates_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "actions" (
    "action_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "action_candidate_id" TEXT,
    "sku_or_item_id" TEXT,
    "action_title" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "action_strength" TEXT NOT NULL DEFAULT 'Monitor',
    "priority_score" REAL NOT NULL DEFAULT 0,
    "priority_category" TEXT NOT NULL DEFAULT 'new_priority',
    "workflow_state" TEXT NOT NULL DEFAULT 'Candidate',
    "featured_slot" INTEGER,
    "owner_role_or_user" TEXT,
    "owner_name" TEXT,
    "first_surfaced_date" DATETIME,
    "due_date" DATETIME,
    "review_date" DATETIME,
    "completed_date" DATETIME,
    "archived_date" DATETIME,
    "rejected_for_cycle" BOOLEAN NOT NULL DEFAULT false,
    "management_priority_flag" BOOLEAN NOT NULL DEFAULT false,
    "grouped_action_flag" BOOLEAN NOT NULL DEFAULT false,
    "visibility_class" TEXT NOT NULL DEFAULT 'Management Visible',
    "confidence_level" TEXT NOT NULL DEFAULT 'Medium Confidence',
    "original_estimated_impact" REAL,
    "actual_achieved_impact" REAL,
    "detail_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "actions_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "actions_action_candidate_id_fkey" FOREIGN KEY ("action_candidate_id") REFERENCES "action_candidates" ("action_candidate_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "grouped_action_items" (
    "grouped_action_item_id" TEXT NOT NULL PRIMARY KEY,
    "action_id" TEXT NOT NULL,
    "child_reference_id" TEXT NOT NULL,
    "child_status" TEXT NOT NULL DEFAULT 'open',
    "child_note" TEXT,
    CONSTRAINT "grouped_action_items_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "actions" ("action_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notes" (
    "note_id" TEXT NOT NULL PRIMARY KEY,
    "action_id" TEXT NOT NULL,
    "note_type" TEXT NOT NULL,
    "visibility_class" TEXT NOT NULL,
    "note_text" TEXT NOT NULL,
    "created_by" TEXT,
    "created_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notes_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "actions" ("action_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "action_history_archive" (
    "archive_record_id" TEXT NOT NULL PRIMARY KEY,
    "action_id" TEXT NOT NULL,
    "iam_run_id" TEXT NOT NULL,
    "action_title" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "owner_role_or_user" TEXT,
    "first_surfaced_date" DATETIME NOT NULL,
    "completed_date" DATETIME,
    "archived_date" DATETIME NOT NULL,
    "original_estimated_impact" REAL,
    "actual_achieved_impact" REAL,
    CONSTRAINT "action_history_archive_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "actions" ("action_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "module_signals" (
    "module_signal_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "source_module" TEXT NOT NULL,
    "signal_type" TEXT NOT NULL,
    "signal_category" TEXT NOT NULL DEFAULT 'Advisory',
    "integration_status" TEXT NOT NULL DEFAULT 'Received',
    "sku_or_item_id" TEXT,
    "summary" TEXT,
    "payload_json" TEXT,
    "confidence_level" TEXT NOT NULL DEFAULT 'Medium Confidence',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "module_signals_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "data_gaps" (
    "data_gap_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "affected_area" TEXT NOT NULL,
    "gap_description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'confidence limiter',
    "blocking_status" TEXT NOT NULL DEFAULT 'partial',
    "status" TEXT NOT NULL DEFAULT 'open',
    "confidence_impact" TEXT NOT NULL,
    CONSTRAINT "data_gaps_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "change_logs" (
    "change_log_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "changed_by" TEXT NOT NULL DEFAULT 'pilot-user',
    "changed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "change_logs_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "upload_batches" (
    "upload_batch_id" TEXT NOT NULL PRIMARY KEY,
    "iam_run_id" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "demand_variant" TEXT,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'staged',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "upload_batches_iam_run_id_fkey" FOREIGN KEY ("iam_run_id") REFERENCES "iam_runs" ("iam_run_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "upload_staging_rows" (
    "upload_staging_row_id" TEXT NOT NULL PRIMARY KEY,
    "upload_batch_id" TEXT NOT NULL,
    "sku_or_item_id" TEXT NOT NULL,
    "description" TEXT,
    "quantity_on_hand" REAL,
    "available_qoh" REAL,
    "cost" REAL,
    "inventory_value" REAL,
    "units_sold" REAL,
    "sales_dollars" REAL,
    "open_order_qty" REAL,
    "source_row_ref" TEXT,
    "classification" TEXT,
    "vendor_name" TEXT,
    "category" TEXT,
    "department" TEXT,
    "location_code" TEXT,
    "product_group" TEXT,
    "item_status" TEXT,
    CONSTRAINT "upload_staging_rows_upload_batch_id_fkey" FOREIGN KEY ("upload_batch_id") REFERENCES "upload_batches" ("upload_batch_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "company_configuration_changes_company_id_field_key_performed_at_idx" ON "company_configuration_changes"("company_id", "field_key", "performed_at");

-- CreateIndex
CREATE INDEX "inventory_snapshots_iam_run_id_sku_or_item_id_idx" ON "inventory_snapshots"("iam_run_id", "sku_or_item_id");

-- CreateIndex
CREATE INDEX "inventory_snapshots_evidence_batch_id_idx" ON "inventory_snapshots"("evidence_batch_id");

-- CreateIndex
CREATE INDEX "demand_history_iam_run_id_sku_or_item_id_idx" ON "demand_history"("iam_run_id", "sku_or_item_id");

-- CreateIndex
CREATE INDEX "demand_history_evidence_batch_id_idx" ON "demand_history"("evidence_batch_id");

-- CreateIndex
CREATE INDEX "receipt_history_summary_iam_run_id_sku_or_item_id_idx" ON "receipt_history_summary"("iam_run_id", "sku_or_item_id");

-- CreateIndex
CREATE INDEX "incoming_supply_iam_run_id_sku_or_item_id_idx" ON "incoming_supply"("iam_run_id", "sku_or_item_id");

-- CreateIndex
CREATE INDEX "evidence_batches_iam_run_id_source_report_type_idx" ON "evidence_batches"("iam_run_id", "source_report_type");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_batches_iam_run_id_external_batch_key_key" ON "evidence_batches"("iam_run_id", "external_batch_key");

-- CreateIndex
CREATE INDEX "evidence_conflicts_iam_run_id_sku_or_item_id_idx" ON "evidence_conflicts"("iam_run_id", "sku_or_item_id");

-- CreateIndex
CREATE INDEX "recommendations_iam_run_id_opportunity_key_idx" ON "recommendations"("iam_run_id", "opportunity_key");

-- CreateIndex
CREATE INDEX "recommendations_iam_run_id_generation_path_idx" ON "recommendations"("iam_run_id", "generation_path");

-- CreateIndex
CREATE INDEX "recommendations_iam_run_id_presentation_category_idx" ON "recommendations"("iam_run_id", "presentation_category");

-- CreateIndex
CREATE INDEX "recommendations_iam_run_id_priority_score_idx" ON "recommendations"("iam_run_id", "priority_score");

-- CreateIndex
CREATE UNIQUE INDEX "recommendations_iam_run_id_source_module_source_recommendation_id_key" ON "recommendations"("iam_run_id", "source_module", "source_recommendation_id");

-- CreateIndex
CREATE INDEX "recommendation_assignments_recommendation_id_active_idx" ON "recommendation_assignments"("recommendation_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_contributors_recommendation_id_user_id_key" ON "recommendation_contributors"("recommendation_id", "user_id");

-- CreateIndex
CREATE INDEX "recommendation_assignment_history_recommendation_id_created_at_idx" ON "recommendation_assignment_history"("recommendation_id", "created_at");

-- CreateIndex
CREATE INDEX "recommendation_notes_recommendation_id_created_at_idx" ON "recommendation_notes"("recommendation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "financial_impacts_recommendation_id_revision_key" ON "financial_impacts"("recommendation_id", "revision");

-- CreateIndex
CREATE INDEX "governance_decisions_iam_run_id_decision_type_idx" ON "governance_decisions"("iam_run_id", "decision_type");

-- CreateIndex
CREATE INDEX "governance_decisions_recommendation_id_idx" ON "governance_decisions"("recommendation_id");

-- CreateIndex
CREATE INDEX "workflow_events_recommendation_id_event_time_idx" ON "workflow_events"("recommendation_id", "event_time");

-- CreateIndex
CREATE INDEX "audit_events_iam_run_id_performed_at_idx" ON "audit_events"("iam_run_id", "performed_at");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "action_history_archive_action_id_key" ON "action_history_archive"("action_id");

-- CreateIndex
CREATE INDEX "module_signals_iam_run_id_sku_or_item_id_idx" ON "module_signals"("iam_run_id", "sku_or_item_id");

-- CreateIndex
CREATE INDEX "upload_batches_iam_run_id_file_type_idx" ON "upload_batches"("iam_run_id", "file_type");

-- CreateIndex
CREATE INDEX "upload_staging_rows_upload_batch_id_sku_or_item_id_idx" ON "upload_staging_rows"("upload_batch_id", "sku_or_item_id");

