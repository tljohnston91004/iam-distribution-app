/**
 * Data Hub client / consumer foundation for IAM (Stage 4A).
 *
 * IAM consumes GOVERNED Data Hub views only. It never reads a raw Keystroke file and never calls a path that is not
 * listed here:
 *   - GET  /api/v1/iam-input-contracts
 *   - GET  /api/v1/companies/:id/iam-inputs                              (availability / freshness / validation / mapping)
 *   - GET  /api/v1/companies/:id/iam-inputs/:family/records              (governed values + lineage + quality)
 *   - GET  /api/v1/companies/:id/iam-inputs/rse-health                   (4D-R: governed RSE result + aging / sell-through aggregates)
 *   - GET  /api/v1/companies/:id/iam/results-return/sync-status          (schedule cross-check)
 *   - POST /api/v1/companies/:id/iam/results-return/events               (Results Return producer)
 *
 * Authentication follows the RSE precedent for Data Hub V1: identity headers x-identity-id / x-user-id / x-company-id /
 * x-correlation-id (+ optional Bearer). Here the identity is the IAM SERVICE identity, never a person.
 *
 * Transport problems never throw out of `submitResultsReturnEvent`: they are returned as a classified result so the
 * outbox can keep the event. Read methods throw a DataHubClientError carrying the failure category.
 */
import { randomUUID } from "crypto";
import type { DposIntegrationConfig } from "./config";
import { outboundIdentityHeaders, type ServiceIdentityRecord } from "./service-identity";
import {
  classifyIamSubmissionResult,
  type IamResultsReturnAcknowledgement,
  type IamSubmissionOutcome,
} from "./contract/iam-results-return";

export const IAM_INPUT_FAMILY_LIST = ["OPEN_PURCHASE_ORDER_LINE", "CUSTOMER_BACKORDER_LINE"] as const;
export type IamInputFamily = (typeof IAM_INPUT_FAMILY_LIST)[number];

export type ClientFailureCategory = "TEMPORARY_TECHNICAL" | "DATA_VALIDATION" | "CONFIGURATION_SYSTEM";

export class DataHubClientError extends Error {
  constructor(
    public readonly category: ClientFailureCategory,
    public readonly code: string,
    message: string,
    public readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "DataHubClientError";
  }
}

/** Governed record view returned by Data Hub (mirrors services/data-hub/src/domain/iam-input-read.ts). */
export interface GovernedInputRecord {
  canonicalRecordId: string;
  businessKey: string;
  version: number;
  publicationStatus: string;
  /** Governed values. `parentSku` is Stck#; `childPartOrVariant` is Class — preserved exactly, never normalized. */
  values: Record<string, unknown> & { parentSku?: string; childPartOrVariant?: string | null };
  effectiveAt: string | null;
  observedAt: string;
  confidence: string;
  confidenceComponents: unknown;
  /** Source run identity (import batch). */
  importBatchId: string | null;
  lineage: {
    lineageId: string;
    sourceSystemId: string;
    sourceObjectType: string;
    sourceRecordId: string;
    sourceFileId: string | null;
    sourceLocation: string | null;
    ingestionBatchId: string;
    mappingProfileId: string;
    mappingProfileVersion: string;
    transformationChainId: string;
    ingestedAt: string;
    canonicalizedAt: string;
  } | null;
  quality: {
    confidenceStatus: string;
    confidenceScore: string | null;
    completenessScore: string;
    validationStatus: string;
    freshnessStatus: string;
    exceptionCount: number;
    hasBlockingException: boolean;
    lastSourceUpdateAt: string | null;
    lastIngestedAt: string;
    lastValidatedAt: string;
    qualityRuleVersion: string;
    assessmentType: string;
  } | null;
}

export interface GovernedInputPage {
  companyId: string;
  family: IamInputFamily;
  contractId: string;
  contractVersion: string;
  generatedAt: string;
  source: Record<string, unknown> | null;
  records: GovernedInputRecord[];
  nextCursor: string | null;
}

export interface InputSourceStatus {
  objectFamily: IamInputFamily;
  availability: "AVAILABLE" | "NOT_SUPPLIED" | "NO_SUCCESSFUL_RUN";
  latestSuccessfulRun: {
    importBatchId: string;
    dataSourceId: string;
    status: string;
    receivedAt: string;
    sourceRunAt?: string | null;
    ingestedAt?: string;
  } | null;
  freshness: { status: string; referenceTimestamp?: string; ageHours?: number | null; referenceBasis?: string } | null;
  [k: string]: unknown;
}

export interface InputStatusResponse {
  companyId: string;
  generatedAt: string;
  sources: InputSourceStatus[];
}

export type SubmitResult =
  | {
      kind: "RESPONSE";
      httpStatus: number;
      acknowledgement: IamResultsReturnAcknowledgement | null;
      outcome: IamSubmissionOutcome;
      durationMs: number;
      correlationId: string;
    }
  | {
      kind: "TRANSPORT_FAILURE";
      httpStatus: null;
      acknowledgement: null;
      outcome: IamSubmissionOutcome;
      durationMs: number;
      correlationId: string;
      networkError: boolean;
      timedOut: boolean;
      message: string;
    };

export interface DataHubClientDeps {
  config: DposIntegrationConfig;
  identity: Pick<ServiceIdentityRecord, "identityId" | "credentialRef">;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  newCorrelationId?: () => string;
}

export class DataHubClient {
  private readonly fetchImpl: typeof fetch;
  private readonly companyId: string;

  constructor(private readonly deps: DataHubClientDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.companyId = deps.config.dataHubCompanyId;
  }

  private correlation(): string {
    return (this.deps.newCorrelationId ?? randomUUID)();
  }

  private headers(correlationId: string, withBody: boolean): Record<string, string> {
    return {
      accept: "application/json",
      ...(withBody ? { "content-type": "application/json" } : {}),
      ...outboundIdentityHeaders(this.deps.identity, this.companyId, correlationId, this.deps.env),
    };
  }

  private async raw(
    method: "GET" | "POST",
    baseUrl: string,
    pathAndQuery: string,
    body?: string,
  ): Promise<{ status: number; json: any; text: string; correlationId: string; durationMs: number }> {
    const correlationId = this.correlation();
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.config.dataHub.httpTimeoutMs);
    try {
      const res = await this.fetchImpl(`${baseUrl}${pathAndQuery}`, {
        method,
        headers: this.headers(correlationId, body !== undefined),
        body,
        signal: controller.signal,
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: res.status, json, text, correlationId, durationMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }

  private async get<T>(pathAndQuery: string): Promise<T> {
    let r;
    try {
      r = await this.raw("GET", this.deps.config.dataHub.baseUrl, pathAndQuery);
    } catch (e) {
      const timedOut = (e as Error).name === "AbortError";
      throw new DataHubClientError(
        "TEMPORARY_TECHNICAL",
        timedOut ? "TIMEOUT" : "NETWORK_ERROR",
        timedOut ? "Data Hub did not respond in time" : "Data Hub could not be reached",
      );
    }
    if (r.status >= 200 && r.status < 300) return r.json as T;
    const code = r.json?.error?.code ?? `HTTP_${r.status}`;
    const message = r.json?.error?.message ?? `Data Hub returned HTTP ${r.status}`;
    if (r.status === 401 || r.status === 403) throw new DataHubClientError("CONFIGURATION_SYSTEM", code, message, r.status);
    if (r.status === 408 || r.status === 429 || r.status >= 500) throw new DataHubClientError("TEMPORARY_TECHNICAL", code, message, r.status);
    throw new DataHubClientError("DATA_VALIDATION", code, message, r.status);
  }

  private assertCompany(actual: unknown, what: string): void {
    if (typeof actual !== "string" || actual.toLowerCase() !== this.companyId.toLowerCase()) {
      throw new DataHubClientError(
        "CONFIGURATION_SYSTEM",
        "DATA_HUB_COMPANY_MISMATCH",
        `${what} returned a different company than the configured Data Hub company; response rejected`,
      );
    }
  }

  async getInputContracts(): Promise<{ contracts: Array<Record<string, unknown>> }> {
    return this.get("/api/v1/iam-input-contracts");
  }

  async getInputStatus(): Promise<InputStatusResponse> {
    const res = await this.get<InputStatusResponse>(`/api/v1/companies/${this.companyId}/iam-inputs`);
    this.assertCompany(res.companyId, "iam-inputs status");
    return res;
  }

  async readInputRecordsPage(family: IamInputFamily, opts: { limit?: number; cursor?: string | null } = {}): Promise<GovernedInputPage> {
    if (!(IAM_INPUT_FAMILY_LIST as readonly string[]).includes(family)) {
      throw new DataHubClientError("DATA_VALIDATION", "UNSUPPORTED_FAMILY", `Unsupported input family ${String(family)}`);
    }
    const qs = new URLSearchParams();
    if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
    if (opts.cursor) qs.set("cursor", opts.cursor);
    const q = qs.toString();
    const page = await this.get<GovernedInputPage>(
      `/api/v1/companies/${this.companyId}/iam-inputs/${family}/records${q ? `?${q}` : ""}`,
    );
    this.assertCompany(page.companyId, "iam-inputs records");
    if (page.family !== family) {
      throw new DataHubClientError("DATA_VALIDATION", "FAMILY_MISMATCH", "Data Hub returned a different input family than requested");
    }
    return page;
  }

  /**
   * Stage 4D-R: the governed aggregate RSE result + raw aging / sell-through evidence for the Health components
   * (GET .../iam-inputs/rse-health). Same dedicated capability as the other governed reads; read-only. The caller validates the
   * pinned contract (see health/rse-input.ts `assertPinnedContract`).
   */
  async readRseHealthInputs(horizonDays?: number): Promise<any> {
    const q = horizonDays !== undefined ? `?horizonDays=${encodeURIComponent(String(horizonDays))}` : "";
    const view = await this.get<{ companyId?: unknown }>(`/api/v1/companies/${this.companyId}/iam-inputs/rse-health${q}`);
    this.assertCompany(view.companyId, "iam-inputs rse-health");
    return view;
  }

  /** Iterate every governed record of a family, page by page. */
  async *iterateInputRecords(family: IamInputFamily, opts: { pageSize?: number; maxPages?: number } = {}): AsyncGenerator<GovernedInputRecord> {
    let cursor: string | null = null;
    let pages = 0;
    const maxPages = opts.maxPages ?? 10_000;
    do {
      const page: GovernedInputPage = await this.readInputRecordsPage(family, { limit: opts.pageSize ?? 200, cursor });
      for (const r of page.records) yield r;
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < maxPages);
  }

  async getSyncStatus(): Promise<{ refresh?: { schedule?: { timeZone?: string; refreshHourLocal?: number }; nextAuthoritativeRefreshAt?: string | null } } & Record<string, unknown>> {
    return this.get(`/api/v1/companies/${this.companyId}/iam/results-return/sync-status`);
  }

  /**
   * Submit one already-persisted Results Return event. Never throws for transport or HTTP problems: the result is
   * classified (TEMPORARY / DATA / CONFIGURATION) so the outbox can keep and route the event.
   */
  async submitResultsReturnEvent(payloadJson: string): Promise<SubmitResult> {
    const started = Date.now();
    try {
      const r = await this.raw(
        "POST",
        this.deps.config.resultsReturn.baseUrl,
        `/api/v1/companies/${this.companyId}/iam/results-return/events`,
        payloadJson,
      );
      const ack: IamResultsReturnAcknowledgement | null = r.json?.acknowledgement ?? null;
      let outcome = classifyIamSubmissionResult({ httpStatus: r.status, acknowledgement: ack });
      if (r.status >= 200 && r.status < 300 && !ack) {
        // A success status without a readable acknowledgement is not proof of acceptance: keep the event and retry
        // (Data Hub replies idempotently with the same producerEventId).
        outcome = {
          ...classifyIamSubmissionResult({ networkError: true }),
          failureReasonCode: "MALFORMED_SUCCESS_RESPONSE",
          failureReason: "Data Hub returned a success status without a readable acknowledgement",
        };
      }
      return { kind: "RESPONSE", httpStatus: r.status, acknowledgement: ack, outcome, durationMs: r.durationMs, correlationId: r.correlationId };
    } catch (e) {
      const timedOut = (e as Error).name === "AbortError";
      const outcome = classifyIamSubmissionResult({ networkError: !timedOut, timedOut });
      return {
        kind: "TRANSPORT_FAILURE",
        httpStatus: null,
        acknowledgement: null,
        outcome,
        durationMs: Date.now() - started,
        correlationId: "n/a",
        networkError: !timedOut,
        timedOut,
        message: (e as Error).message,
      };
    }
  }
}
