/**
 * Stage 4D Inventory Management Health Score (IAM_HEALTH_SCORE_V1).
 *
 * Five components (Position & Balance 40, Efficiency 20, Slow / Nonmoving 15, Customer Shortage / Backorder 15, Action Resolution 10),
 * renormalized when a component is unavailable (never scored as zero), with immutable history by company and review cycle.
 * It consumes governed RSE results and governed Data Hub feeds; it never recreates Min/Max or classification and never scores
 * candidates.
 */
export * from "./config";
export * from "./composite";
export * from "./evidence";
export * from "./sell-through";
export * from "./components";
export * from "./backorder";
export * from "./service";
export * from "./rse-input";
export * from "./diagnostics";
export * from "./component-source";
export * from "./pipeline";
export * from "./company-config";
