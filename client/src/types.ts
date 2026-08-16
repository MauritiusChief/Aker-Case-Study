export type QualitySeverity = "error" | "warning";

export interface DataQualityIssue {
  code: string;
  severity: QualitySeverity;
  message: string;
  property_code?: string;
  unit_code?: string;
  resident_id?: string;
}

export interface AvailabilitySummary {
  property_code: string;
  property_name: string | null;
  avg_sq_ft: number | null;
  avg_rent: number | null;
  total_units: number;
  occupied_no_notice: number;
  vacant_rented: number;
  vacant_unrented: number;
  notice_rented: number;
  notice_unrented: number;
  avail: number;
  model: number;
  down: number;
  admin: number;
  occupancy_pct: number;
  occ_w_non_rev_pct: number;
  leased_pct: number;
  occupied: number;
  vacant: number;
}

export interface LeaseExpirationBuckets {
  "0_30": number;
  "31_60": number;
  "61_90": number;
  "91_180": number;
  over_180: number;
  expired: number;
  missing: number;
}

export interface PropertyPriorityRow {
  property_code: string;
  property_name: string | null;
  total_units: number;
  avail: number;
  occupancy_pct: number;
  leased_pct: number;
  expiring_60: number;
  vacant_unrented_exposure: number;
}

export interface PortfolioMetrics {
  total_properties: number;
  total_units: number;
  physical_occupancy_pct: number;
  leased_pct: number;
  available_units: number;
  vacant_unrented_exposure: number;
  expiring_60_days: number;
  availability: AvailabilitySummary[];
  lease_expiration_buckets: LeaseExpirationBuckets;
  property_priority: PropertyPriorityRow[];
}

export interface PortfolioSummary {
  as_of_date: string;
  month_year: string;
  filters: Record<string, unknown>;
  metrics: PortfolioMetrics;
  definitions: Record<string, string>;
  coverage: Record<string, number>;
  data_quality: DataQualityIssue[];
}

export type LeaseBucket =
  | "0_30"
  | "31_60"
  | "61_90"
  | "91_180"
  | "over_180"
  | "expired"
  | "missing";

export type AvailabilityStatus =
  | "occupied_no_notice"
  | "notice_rented"
  | "notice_unrented";

export interface LeaseRiskRow {
  property_code: string;
  property_name: string | null;
  unit_code: string;
  unit_type: string | null;
  resident_id: string;
  resident_name: string | null;
  lease_end_date: string | null;
  move_out_date: string | null;
  move_in_date: string | null;
  market_rent: number | null;
  scheduled_base_rent: number;
  loss_to_lease: number | null;
  loss_to_lease_pct: number | null;
  balance: number | null;
  availability_status: AvailabilityStatus;
  bucket: LeaseBucket;
}

export interface LeaseRiskMetrics {
  total_records: number;
  total_scheduled_base_rent: number;
  total_market_rent: number;
  total_loss_to_lease: number;
  positive_loss_to_lease_count: number;
  premium_count: number;
  buckets: LeaseExpirationBuckets;
}

export interface LeaseRiskSummary {
  as_of_date: string;
  month_year: string;
  filters: Record<string, unknown>;
  metrics: LeaseRiskMetrics;
  rows: LeaseRiskRow[];
  pagination: {
    page: number;
    page_size: number;
    total_pages: number;
  };
  options: {
    properties: { code: string; name: string | null }[];
    unit_types: string[];
  };
  definitions: Record<string, string>;
  coverage: Record<string, number>;
  data_quality: DataQualityIssue[];
}

export interface RentGapGroup {
  key: string;
  label: string | null;
  occupied_units: number;
  comparable_units: number;
  avg_market_rent: number | null;
  avg_base_rent: number | null;
  avg_loss_to_lease: number | null;
  total_loss_to_lease: number | null;
  positive_count: number;
  premium_count: number;
}

export interface RentGapMetrics {
  total_occupied_units: number;
  comparable_units: number;
  positive_loss_to_lease_count: number;
  positive_loss_to_lease_amount: number;
  premium_count: number;
  total_loss_to_lease: number;
  avg_loss_to_lease: number | null;
}

export interface RentGapSummary {
  as_of_date: string;
  month_year: string;
  filters: Record<string, unknown>;
  metrics: RentGapMetrics;
  by_property: RentGapGroup[];
  by_unit_type: RentGapGroup[];
  definitions: Record<string, string>;
  coverage: Record<string, number>;
  data_quality: DataQualityIssue[];
}

export interface PropertyChargeCodeRow {
  charge_code: string;
  category: "base_rent" | "other";
  amount: number;
  resident_count: number;
}

export interface PropertySummary {
  as_of_date: string;
  month_year: string;
  property: { code: string; name: string | null };
  filters: Record<string, unknown>;
  metrics: {
    total_units: number;
    occupied: number;
    vacant: number;
    avail: number;
    occupancy_pct: number;
    leased_pct: number;
    vacant_unrented_exposure: number;
    expiring_60: number;
    total_base_rent: number;
    comparable_units: number;
    total_loss_to_lease: number;
    avg_loss_to_lease: number | null;
    positive_loss_to_lease_count: number;
    premium_count: number;
  };
  availability: AvailabilitySummary | null;
  lease_expiration_buckets: LeaseExpirationBuckets;
  charge_codes: PropertyChargeCodeRow[];
  definitions: Record<string, string>;
  coverage: Record<string, number>;
  data_quality: DataQualityIssue[];
}

export type MorningBriefFindingPriority = "critical" | "high" | "medium" | "low";

export interface MorningBriefSourceCitation {
  source_id: string;
  path: string;
}

export interface MorningBriefFinding {
  id: string;
  title: string;
  summary: string;
  priority: MorningBriefFindingPriority;
  property_codes: string[];
  evidence: MorningBriefSourceCitation[];
  recommended_action?: string;
}

export interface MorningBriefContent {
  as_of_date: string;
  month_year: string;
  model: string;
  facts: MorningBriefFacts;
  findings: MorningBriefFinding[];
  semantic_widgets: MorningBriefSemanticWidget[];
}

export interface MorningBriefCandidate {
  property_code: string;
  property_name: string | null;
  selected_for: string[];
  signals: Record<string, number | undefined>;
  metrics: {
    total_units: number;
    available_units: number;
    vacant_unrented: number;
    notice_unrented: number;
    down_units: number;
    occupancy_pct: number;
    leased_pct: number;
    vacant_unrented_exposure: number;
    expiring_60: number;
    total_loss_to_lease: number | null;
    comparable_units: number;
  };
}

export interface MorningBriefFacts {
  as_of_date: string;
  month_year: string;
  scope: {
    kind: string;
    candidate_property_codes: string[];
    portfolio_property_codes: string[];
  };
  portfolio: {
    total_properties: number;
    total_units: number;
    physical_occupancy_pct: number;
    leased_pct: number;
    available_units: number;
    vacant_unrented_exposure: number;
    expiring_60_days: number;
    total_loss_to_lease: number;
    positive_loss_to_lease_count: number;
  };
  coverage: Record<string, number>;
  data_quality: {
    error_count: number;
    warning_count: number;
    by_code: Array<{ code: string; severity: QualitySeverity; count: number }>;
  };
  properties: MorningBriefCandidate[];
  candidates: MorningBriefCandidate[];
  limitations: string[];
}

export type MorningBriefSemanticWidgetType =
  | "kpi"
  | "property_comparison"
  | "availability"
  | "lease_expirations"
  | "rent_gap"
  | "data_quality";

export interface MorningBriefSemanticWidget {
  id: string;
  type: MorningBriefSemanticWidgetType;
  title: string;
  scope: { level: "portfolio" | "property" | "comparison"; property_codes: string[] };
  source_ids: string[];
  filters?: { lease_bucket?: string };
}

export interface MorningBriefSnapshot {
  id: string;
  as_of_date: string;
  captured_at: string;
}

interface MorningBriefWidgetBase {
  id: string;
  title: string;
  subtitle?: string;
  pinned: boolean;
}

export interface PortfolioKpisWidget extends MorningBriefWidgetBase {
  type: "portfolio_kpis";
  data: {
    items: Array<{
      label: string;
      value: number;
      format: "number" | "currency" | "percent";
      hint?: string;
    }>;
  };
}

export interface PropertyRankingWidget extends MorningBriefWidgetBase {
  type: "property_ranking";
  data: { rows: PropertyPriorityRow[] };
}

export interface AvailabilityBreakdownWidget extends MorningBriefWidgetBase {
  type: "availability_breakdown";
  data: {
    rows: Array<{
      property_code: string;
      property_name: string | null;
      total_units: number;
      available_units: number;
      occupancy_pct: number;
      notice_unrented: number;
      down_units: number;
    }>;
  };
}

export interface LeaseExpirationWidget extends MorningBriefWidgetBase {
  type: "lease_expiration";
  data: { rows: Array<{ property_code: string; property_name: string | null; expiring_60: number }> };
}

export interface RentGapRankingWidget extends MorningBriefWidgetBase {
  type: "rent_gap_ranking";
  data: {
    rows: Array<{
      property_code: string;
      property_name: string | null;
      comparable_units: number;
      total_loss_to_lease: number | null;
    }>;
  };
}

export interface DataQualityWidget extends MorningBriefWidgetBase {
  type: "data_quality";
  data: {
    error_count: number;
    warning_count: number;
    by_code: Array<{ code: string; severity: QualitySeverity; count: number }>;
    limitations: string[];
  };
}

export type MorningBriefWidget =
  | PortfolioKpisWidget
  | PropertyRankingWidget
  | AvailabilityBreakdownWidget
  | LeaseExpirationWidget
  | RentGapRankingWidget
  | DataQualityWidget;

export type MorningBriefWidgetType = MorningBriefWidget["type"];

export interface MorningBriefGenerateRequest {
  base_revision: number;
  snapshot?: MorningBriefSnapshot;
}

export interface MorningBriefGenerateResponse {
  brief: MorningBriefContent;
  widgets: MorningBriefWidget[];
  snapshot: MorningBriefSnapshot;
  revision: number;
}

export interface MorningBriefChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export type MorningBriefWidgetOperation =
  | { operation: "upsert"; widget: MorningBriefWidget }
  | { operation: "delete"; widget_id: string };

export interface MorningBriefWidgetTransaction {
  base_revision: number;
  operations: MorningBriefWidgetOperation[];
}

export interface MorningBriefAssistantRequest {
  question: string;
  recent_chat: MorningBriefChatMessage[];
  brief: MorningBriefContent;
  widgets: MorningBriefWidget[];
  snapshot: MorningBriefSnapshot;
  revision: number;
}

export interface MorningBriefAssistantResponse {
  answer: string;
  snapshot: MorningBriefSnapshot;
  revision: number;
  widget_transaction?: MorningBriefWidgetTransaction;
  widget_state?: MorningBriefWidget[];
  semantic_widgets: MorningBriefSemanticWidget[];
}

export type MorningBriefErrorCode =
  | "NOT_CONFIGURED"
  | "AUTH_REQUIRED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "INVESTIGATION_LIMIT";

export interface StructuredApiError {
  code: MorningBriefErrorCode;
  message: string;
}
