import type {
  LeaseRiskSummary,
  PortfolioSummary,
  PropertySummary,
  RentGapSummary,
  MorningBriefAssistantRequest,
  MorningBriefAssistantResponse,
  MorningBriefErrorCode,
  MorningBriefGenerateRequest,
  MorningBriefGenerateResponse,
  MorningBriefFacts,
  MorningBriefFinding,
  MorningBriefSemanticWidget,
  MorningBriefWidget,
} from "../types";

const API_BASE = "/api";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function fetchPortfolioSummary(): Promise<PortfolioSummary> {
  return getJson<PortfolioSummary>("/portfolio/summary");
}

export interface LeaseRiskQuery {
  property?: string;
  bucket?: string;
  unit_type?: string;
  has_move_out?: boolean;
  has_positive_balance?: boolean;
  rent_gap_min?: number;
  rent_gap_max?: number;
  page?: number;
}

function toQueryString(query: LeaseRiskQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function fetchLeaseRisks(query: LeaseRiskQuery = {}): Promise<LeaseRiskSummary> {
  return getJson<LeaseRiskSummary>(`/lease-risks${toQueryString(query)}`);
}

export function fetchRentGap(): Promise<RentGapSummary> {
  return getJson<RentGapSummary>("/rent-gap");
}

export function fetchPropertySummary(propertyCode: string): Promise<PropertySummary> {
  return getJson<PropertySummary>(`/properties/${propertyCode}/summary`);
}

export class MorningBriefApiError extends Error {
  readonly code: MorningBriefErrorCode;

  constructor(code: MorningBriefErrorCode, message: string) {
    super(message);
    this.name = "MorningBriefApiError";
    this.code = code;
  }
}

const REQUEST_TIMEOUT_MS = 45_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFinding(value: unknown): value is MorningBriefFinding {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.title) &&
    isString(value.summary) &&
    ["critical", "high", "medium", "low"].includes(String(value.priority)) &&
    Array.isArray(value.property_codes) && value.property_codes.every(isString) &&
    Array.isArray(value.evidence) && value.evidence.every((citation) =>
      isRecord(citation) && isString(citation.source_id) && isString(citation.path)
    ) &&
    (value.recommended_action === undefined || typeof value.recommended_action === "string")
  );
}

function isCandidate(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.property_code) &&
    (value.property_name === null || typeof value.property_name === "string") &&
    Array.isArray(value.selected_for) && value.selected_for.every(isString) &&
    isRecord(value.signals) &&
    isRecord(value.metrics) &&
    hasNumbers(value.metrics, [
      "total_units", "available_units", "vacant_unrented", "notice_unrented", "down_units",
      "occupancy_pct", "leased_pct", "vacant_unrented_exposure", "expiring_60", "comparable_units",
    ]) &&
    (value.metrics.total_loss_to_lease === null || isFiniteNumber(value.metrics.total_loss_to_lease))
  );
}

function hasNumbers(value: unknown, keys: string[]): boolean {
  return isRecord(value) && keys.every((key) => isFiniteNumber(value[key]));
}

function isFacts(value: unknown): value is MorningBriefFacts {
  return (
    isRecord(value) &&
    isString(value.as_of_date) && isString(value.month_year) &&
    isRecord(value.scope) && Array.isArray(value.scope.candidate_property_codes) &&
    value.scope.candidate_property_codes.every(isString) &&
    Array.isArray(value.scope.portfolio_property_codes) &&
    value.scope.portfolio_property_codes.every(isString) &&
    isRecord(value.portfolio) && hasNumbers(value.portfolio, [
      "total_properties", "total_units", "physical_occupancy_pct", "leased_pct",
      "available_units", "vacant_unrented_exposure", "expiring_60_days",
      "total_loss_to_lease", "positive_loss_to_lease_count",
    ]) &&
    isRecord(value.coverage) && Object.values(value.coverage).every(isFiniteNumber) &&
    isRecord(value.data_quality) && hasNumbers(value.data_quality, ["error_count", "warning_count"]) &&
    Array.isArray(value.data_quality.by_code) && value.data_quality.by_code.every((row) =>
      isRecord(row) && isString(row.code) && ["error", "warning"].includes(String(row.severity)) &&
      isFiniteNumber(row.count)
    ) &&
    Array.isArray(value.properties) && value.properties.every(isCandidate) &&
    Array.isArray(value.candidates) && value.candidates.every(isCandidate) &&
    Array.isArray(value.limitations) && value.limitations.every((item) => typeof item === "string")
  );
}

function isSemanticWidget(value: unknown): value is MorningBriefSemanticWidget {
  if (!isRecord(value) || !isString(value.id) || !isString(value.title) ||
    !["kpi", "property_comparison", "availability", "lease_expirations", "rent_gap", "data_quality"].includes(String(value.type)) ||
    !isRecord(value.scope) || !["portfolio", "property", "comparison"].includes(String(value.scope.level)) ||
    !Array.isArray(value.scope.property_codes) || !value.scope.property_codes.every(isString) ||
    !Array.isArray(value.source_ids) || !value.source_ids.every(isString)) return false;
  return value.filters === undefined || (isRecord(value.filters) &&
    (value.filters.lease_bucket === undefined || typeof value.filters.lease_bucket === "string"));
}

function isPropertyRankingRow(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.property_code) &&
    (value.property_name === null || typeof value.property_name === "string") &&
    hasNumbers(value, [
      "total_units", "avail", "occ_pct", "leased_pct", "expiring_60",
      "vacant_unrented_exposure",
    ])
  );
}

function isRentGapRow(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.property_code) &&
    (value.property_name === null || typeof value.property_name === "string") &&
    isFiniteNumber(value.comparable_units) &&
    (value.total_loss_to_lease === null || isFiniteNumber(value.total_loss_to_lease))
  );
}

export function isMorningBriefWidget(value: unknown): value is MorningBriefWidget {
  if (
    !isRecord(value) ||
    !isString(value.id) ||
    !isString(value.title) ||
    typeof value.pinned !== "boolean" ||
    (value.subtitle !== undefined && typeof value.subtitle !== "string") ||
    !isRecord(value.data)
  ) return false;

  switch (value.type) {
    case "portfolio_kpis":
      return Array.isArray(value.data.items) && value.data.items.every((item) =>
        isRecord(item) && isString(item.label) && isFiniteNumber(item.value) &&
        ["number", "currency", "percent"].includes(String(item.format)) &&
        (item.hint === undefined || typeof item.hint === "string")
      );
    case "property_ranking":
      return Array.isArray(value.data.rows) && value.data.rows.every(isPropertyRankingRow);
    case "availability_breakdown":
      return Array.isArray(value.data.rows) && value.data.rows.every((row) =>
        isRecord(row) && isString(row.property_code) &&
        (row.property_name === null || typeof row.property_name === "string") &&
        hasNumbers(row, ["total_units", "available_units", "occupancy_pct", "notice_unrented", "down_units"])
      );
    case "lease_expiration":
      return Array.isArray(value.data.rows) && value.data.rows.every((row) =>
        isRecord(row) && isString(row.property_code) &&
        (row.property_name === null || typeof row.property_name === "string") && isFiniteNumber(row.expiring_60)
      );
    case "rent_gap_ranking":
      return Array.isArray(value.data.rows) && value.data.rows.every(isRentGapRow);
    case "data_quality":
      return hasNumbers(value.data, ["error_count", "warning_count"]) &&
        Array.isArray(value.data.by_code) && value.data.by_code.every((row) =>
          isRecord(row) && isString(row.code) && ["error", "warning"].includes(String(row.severity)) &&
          isFiniteNumber(row.count)
        ) && Array.isArray(value.data.limitations) && value.data.limitations.every((item) => typeof item === "string");
    default:
      return false;
  }
}

function scopedCandidates(facts: MorningBriefFacts, widget: MorningBriefSemanticWidget) {
  const codes = widget.scope.property_codes;
  return codes.length
    ? facts.properties.filter((property) => codes.includes(property.property_code))
    : facts.properties;
}

function toClientWidget(widget: MorningBriefSemanticWidget, facts: MorningBriefFacts): MorningBriefWidget {
  const candidates = scopedCandidates(facts, widget);
  const base = { id: widget.id, title: widget.title, pinned: false };
  switch (widget.type) {
    case "kpi":
      if (widget.scope.level === "property" && candidates.length === 1) {
        const metrics = candidates[0].metrics;
        return { ...base, type: "portfolio_kpis", data: { items: [
          { label: "Total units", value: metrics.total_units, format: "number" },
          { label: "Physical occupancy", value: metrics.occupancy_pct, format: "percent" },
          { label: "Leased", value: metrics.leased_pct, format: "percent" },
          { label: "Available units", value: metrics.available_units, format: "number" },
          { label: "Vacant exposure", value: metrics.vacant_unrented_exposure, format: "currency" },
          { label: "Expiring in 60 days", value: metrics.expiring_60, format: "number" },
        ] } };
      }
      return { ...base, type: "portfolio_kpis", data: { items: [
        { label: "Total units", value: facts.portfolio.total_units, format: "number" },
        { label: "Physical occupancy", value: facts.portfolio.physical_occupancy_pct, format: "percent" },
        { label: "Leased", value: facts.portfolio.leased_pct, format: "percent" },
        { label: "Available units", value: facts.portfolio.available_units, format: "number" },
        { label: "Vacant exposure", value: facts.portfolio.vacant_unrented_exposure, format: "currency" },
        { label: "Expiring in 60 days", value: facts.portfolio.expiring_60_days, format: "number" },
      ] } };
    case "property_comparison":
      return { ...base, type: "property_ranking", data: { rows: candidates.map((candidate) => ({
        property_code: candidate.property_code,
        property_name: candidate.property_name,
        total_units: candidate.metrics.total_units,
        avail: candidate.metrics.available_units,
        occ_pct: candidate.metrics.occupancy_pct,
        leased_pct: candidate.metrics.leased_pct,
        expiring_60: candidate.metrics.expiring_60,
        vacant_unrented_exposure: candidate.metrics.vacant_unrented_exposure,
      })) } };
    case "availability":
      return { ...base, type: "availability_breakdown", data: { rows: candidates.map((candidate) => ({
        property_code: candidate.property_code,
        property_name: candidate.property_name,
        total_units: candidate.metrics.total_units,
        available_units: candidate.metrics.available_units,
        occupancy_pct: candidate.metrics.occupancy_pct,
        notice_unrented: candidate.metrics.notice_unrented,
        down_units: candidate.metrics.down_units,
      })) } };
    case "lease_expirations":
      return { ...base, type: "lease_expiration", data: { rows: candidates.map((candidate) => ({
        property_code: candidate.property_code,
        property_name: candidate.property_name,
        expiring_60: candidate.metrics.expiring_60,
      })) } };
    case "rent_gap":
      return { ...base, type: "rent_gap_ranking", data: { rows: candidates.map((candidate) => ({
        property_code: candidate.property_code,
        property_name: candidate.property_name,
        comparable_units: candidate.metrics.comparable_units,
        total_loss_to_lease: candidate.metrics.total_loss_to_lease,
      })) } };
    case "data_quality":
      return { ...base, type: "data_quality", data: {
        ...facts.data_quality,
        limitations: facts.limitations,
      } };
  }
}

function parseGenerateResponse(value: unknown, baseRevision: number): MorningBriefGenerateResponse {
  if (!isRecord(value) || !isString(value.as_of_date) || !isString(value.month_year) ||
    !isString(value.model) || !isFacts(value.facts) || !Array.isArray(value.findings) ||
    !value.findings.every(isFinding) || !Array.isArray(value.widgets) ||
    !value.widgets.every(isSemanticWidget)) {
    throw new MorningBriefApiError("INVALID_RESPONSE", "The generated brief response did not match the client contract.");
  }
  const semanticWidgets = value.widgets as MorningBriefSemanticWidget[];
  return {
    brief: {
      as_of_date: value.as_of_date,
      month_year: value.month_year,
      model: value.model,
      facts: value.facts,
      findings: value.findings,
      semantic_widgets: semanticWidgets,
    },
    widgets: semanticWidgets.map((widget) => toClientWidget(widget, value.facts as MorningBriefFacts)),
    snapshot: {
      id: `${value.month_year}:${value.as_of_date}`,
      as_of_date: value.as_of_date,
      captured_at: new Date().toISOString(),
    },
    revision: baseRevision + 1,
  };
}

function parseAssistantResponse(
  value: unknown,
  request: MorningBriefAssistantRequest
): MorningBriefAssistantResponse {
  if (!isRecord(value) || !isString(value.answer) || !Array.isArray(value.widgets) ||
    !value.widgets.every(isSemanticWidget)) {
    throw new MorningBriefApiError("INVALID_RESPONSE", "The assistant response did not match the client contract.");
  }
  const semanticWidgets = value.widgets as MorningBriefSemanticWidget[];
  return {
    answer: value.answer,
    snapshot: request.snapshot,
    revision: request.revision + 1,
    widget_state: semanticWidgets.map((widget) => toClientWidget(widget, request.brief.facts)),
    semantic_widgets: semanticWidgets,
  };
}

function errorCodeForStatus(status: number): MorningBriefErrorCode {
  if (status === 401 || status === 403) return "AUTH_REQUIRED";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status === 429) return "RATE_LIMITED";
  if (status === 501) return "NOT_CONFIGURED";
  return "PROVIDER_UNAVAILABLE";
}

function normalizeErrorCode(value: unknown, status: number): MorningBriefErrorCode {
  const code = String(value ?? "").toUpperCase();
  if (["NOT_CONFIGURED", "PROVIDER_NOT_CONFIGURED", "AI_NOT_CONFIGURED", "LLM_NOT_CONFIGURED"].includes(code)) return "NOT_CONFIGURED";
  if (["AUTH_REQUIRED", "UNAUTHORIZED", "FORBIDDEN", "LLM_AUTH_FAILED"].includes(code)) return "AUTH_REQUIRED";
  if (["RATE_LIMITED", "RATE_LIMIT", "TOO_MANY_REQUESTS", "LLM_RATE_LIMITED"].includes(code)) return "RATE_LIMITED";
  if (["TIMEOUT", "REQUEST_TIMEOUT", "PROVIDER_TIMEOUT", "LLM_TIMEOUT"].includes(code)) return "TIMEOUT";
  if (["INVALID_RESPONSE", "INVALID_REQUEST", "LLM_INVALID_RESPONSE"].includes(code)) return "INVALID_RESPONSE";
  if (["PROVIDER_UNAVAILABLE", "PROVIDER_ERROR", "UPSTREAM_ERROR", "LLM_PROVIDER_ERROR"].includes(code)) return "PROVIDER_UNAVAILABLE";
  return errorCodeForStatus(status);
}

async function postMorningBrief<T>(
  path: string,
  body: unknown,
  parser: (value: unknown) => T,
  signal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const error = isRecord(payload) && isRecord(payload.error) ? payload.error : payload;
      const codeValue = isRecord(error) ? error.code : undefined;
      const message = isRecord(error) && typeof error.message === "string"
        ? error.message
        : `Request failed with status ${res.status}.`;
      throw new MorningBriefApiError(normalizeErrorCode(codeValue, res.status), message);
    }
    return parser(payload);
  } catch (error) {
    if (error instanceof MorningBriefApiError) throw error;
    if (timedOut) throw new MorningBriefApiError("TIMEOUT", "The AI provider did not respond in time.");
    if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    throw new MorningBriefApiError("PROVIDER_UNAVAILABLE", "The AI provider could not be reached.");
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function generateMorningBrief(
  request: MorningBriefGenerateRequest,
  signal?: AbortSignal
): Promise<MorningBriefGenerateResponse> {
  return postMorningBrief(
    "/morning-brief/generate",
    request,
    (value) => parseGenerateResponse(value, request.base_revision),
    signal
  );
}

export function queryMorningBriefAssistant(
  request: MorningBriefAssistantRequest,
  signal?: AbortSignal
): Promise<MorningBriefAssistantResponse> {
  return postMorningBrief("/assistant/query", {
    question: request.question,
    conversation: request.recent_chat.slice(-8).map(({ role, content }) => ({ role, content })),
    brief: {
      findings: request.brief.findings,
      widgets: request.brief.semantic_widgets,
    },
  }, (value) => parseAssistantResponse(value, request), signal);
}
