export type LlmErrorCode =
  | "llm_not_configured"
  | "llm_auth_failed"
  | "llm_rate_limited"
  | "llm_timeout"
  | "llm_provider_error"
  | "llm_invalid_response"
  | "llm_investigation_limit";

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface ModelToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type ModelToolChoice =
  | "auto"
  | "required"
  | {
      type: "function";
      function: { name: string };
    };

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: ModelToolCall[];
  finish_reason?: string;
}

/** Real business tools the assistant is allowed to call. */
export type AssistantToolName =
  | "get_property_summary"
  | "get_portfolio_comparison"
  | "get_availability"
  | "get_lease_risk"
  | "get_rent_gap"
  | "get_data_quality";

/** Tools that manage the non-citable widget draft for one agent run. */
export type WidgetToolName =
  | "create_widget"
  | "get_widgets"
  | "update_widget"
  | "delete_widget";

/** Terminal tools that submit grounded text without widget state. */
export type SubmissionToolName =
  | "submit_morning_brief"
  | "submit_assistant_answer";

/** Reserved control tool used for application-injected budget updates. */
export type ReservedControlToolName = "_budget_info";

export type MessageToolName =
  | AssistantToolName
  | WidgetToolName
  | SubmissionToolName
  | ReservedControlToolName;

export interface ModelTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ModelRequest {
  messages: ModelMessage[];
  tools: ModelTool[];
  toolChoice?: ModelToolChoice;
}

export interface ChatModel {
  readonly name: string;
  complete(request: ModelRequest): Promise<ModelMessage>;
}

export const WIDGET_TYPES = [
  "kpi",
  "property_comparison",
  "availability",
  "lease_expirations",
  "rent_gap",
  "data_quality",
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

export interface SourceCitation {
  source_id: string;
  path: string;
}

export interface SemanticWidget {
  id: string;
  type: WidgetType;
  title: string;
  scope: {
    level: "portfolio" | "property" | "comparison";
    property_codes: string[];
  };
  source_ids: string[];
  filters?: {
    lease_bucket?: string;
  };
}

export type WidgetOperation =
  | { op: "upsert"; widget: SemanticWidget }
  | { op: "remove" | "focus"; widget_id: string };

export interface BriefFinding {
  id: string;
  title: string;
  summary: string;
  priority: "critical" | "high" | "medium" | "low";
  property_codes: string[];
  evidence: SourceCitation[];
  recommended_action?: string;
}

export interface MorningBriefResult {
  as_of_date: string;
  month_year: string;
  model: string;
  facts: BriefFacts;
  findings: BriefFinding[];
  widget_operations: WidgetOperation[];
  widgets: SemanticWidget[];
  sources: Record<string, unknown>;
  investigation: { tool_calls: number };
}

export interface AssistantAnswerResult {
  as_of_date: string;
  month_year: string;
  model: string;
  answer: string;
  citations: SourceCitation[];
  widget_operations: WidgetOperation[];
  widgets: SemanticWidget[];
  sources: Record<string, unknown>;
  investigation: { tool_calls: number };
}

export type CandidateSignal =
  | "vacant_unrented_exposure"
  | "available_units"
  | "lease_expirations_60"
  | "positive_rent_gap"
  | "down_units"
  | "notice_unrented"
  | "data_quality";

export interface BriefCandidate {
  property_code: string;
  property_name: string | null;
  selected_for: CandidateSignal[];
  signals: Partial<Record<CandidateSignal, number>>;
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

export interface QualityFacts {
  error_count: number;
  warning_count: number;
  by_code: { code: string; severity: "error" | "warning"; count: number }[];
}

export interface BriefFacts {
  as_of_date: string;
  month_year: string;
  scope: {
    kind: "candidate_and_portfolio_comparison";
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
  data_quality: QualityFacts;
  properties: BriefCandidate[];
  candidates: BriefCandidate[];
  limitations: string[];
}

export interface AgentInvestigationState {
  modelAttempts: number;
  toolRounds: number;
  realToolCalls: number;
}

export type AgentSecurityEvent =
  | { type: "budget_info_hallucination"; count: number }
  | { type: "unknown_tool"; name: string }
  | { type: "duplicate_tool_call_id"; id: string }
  | { type: "budget_exceeded"; requested: number; remaining: number }
  | { type: "discarded_tool_calls_on_submit"; count: number };
