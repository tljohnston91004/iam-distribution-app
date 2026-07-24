/**
 * LEGACY BYPASS DISABLED (Phase 2 / R-P2-01).
 *
 * Direct Prisma writes to InventorySnapshot / DemandHistory from Keystroke merge
 * have been removed. All Keystroke evidence enters IAM exclusively through the
 * Canonical Inbound Port via the Keystroke adapter.
 *
 * @deprecated Import `mergeKeystrokeViaInboundPort` from `@/lib/iam/adapters/keystroke`.
 */
export { mergeKeystrokeViaInboundPort as mergeKeystrokeUploads } from "@/lib/iam/adapters/keystroke/merge-via-port";
