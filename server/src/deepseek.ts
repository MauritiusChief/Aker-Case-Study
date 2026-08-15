import {
  AKER_LLM_DEBUG,
  DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL,
  LLM_MODEL,
  LLM_TIMEOUT_MS,
} from "./config.js";
import {
  LlmError,
  type ChatModel,
  type ModelMessage,
  type ModelRequest,
  type ModelToolCall,
} from "./assistant-types.js";

interface DeepSeekOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function isToolCall(value: unknown): value is ModelToolCall {
  if (!value || typeof value !== "object") return false;
  const call = value as Partial<ModelToolCall>;
  return (
    typeof call.id === "string" &&
    call.type === "function" &&
    !!call.function &&
    typeof call.function.name === "string" &&
    typeof call.function.arguments === "string"
  );
}

async function logProviderError(response: Response): Promise<void> {
  if (!AKER_LLM_DEBUG) return;
  try {
    const payload: unknown = await response.json();
    const error = payload && typeof payload === "object" && "error" in payload
      ? (payload as { error?: unknown }).error
      : undefined;
    const details = error && typeof error === "object"
      ? error as Record<string, unknown>
      : {};
    const message = typeof details.message === "string"
      ? details.message.slice(0, 1_000)
      : undefined;
    console.error("[deepseek] provider error", {
      status: response.status,
      type: typeof details.type === "string" ? details.type : undefined,
      code: typeof details.code === "string" || typeof details.code === "number"
        ? details.code
        : undefined,
      param: typeof details.param === "string" ? details.param : undefined,
      message,
    });
  } catch {
    console.error("[deepseek] provider error", {
      status: response.status,
      detail: "The provider error body was not valid JSON",
    });
  }
}

function parseMessage(payload: unknown): ModelMessage {
  if (!payload || typeof payload !== "object") {
    throw new LlmError("llm_invalid_response", "DeepSeek returned no assistant message");
  }
  const body = payload as {
    choices?: {
      finish_reason?: string | null;
      message?: {
        content?: unknown;
        reasoning_content?: unknown;
        tool_calls?: unknown;
      };
    }[];
  };
  const message = body.choices?.[0]?.message;
  if (!message) {
    throw new LlmError("llm_invalid_response", "DeepSeek returned no assistant message");
  }
  if (message.content !== null && typeof message.content !== "string" && message.content !== undefined) {
    throw new LlmError("llm_invalid_response", "DeepSeek returned invalid message content");
  }
  if (
    message.reasoning_content !== null &&
    typeof message.reasoning_content !== "string" &&
    message.reasoning_content !== undefined
  ) {
    throw new LlmError("llm_invalid_response", "DeepSeek returned invalid reasoning content");
  }
  if (message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls) || !message.tool_calls.every(isToolCall)) {
      throw new LlmError("llm_invalid_response", "DeepSeek returned invalid tool calls");
    }
  }
  const finishReason = body.choices?.[0]?.finish_reason;
  return {
    role: "assistant",
    content: typeof message.content === "string" ? message.content : null,
    ...(typeof message.reasoning_content === "string"
      ? { reasoning_content: message.reasoning_content }
      : {}),
    tool_calls: message.tool_calls as ModelToolCall[] | undefined,
    ...(typeof finishReason === "string" ? { finish_reason: finishReason } : {}),
  };
}

export class DeepSeekChatModel implements ChatModel {
  readonly name: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DeepSeekOptions = {}) {
    this.apiKey = options.apiKey ?? DEEPSEEK_API_KEY;
    this.baseUrl = (options.baseUrl ?? DEEPSEEK_BASE_URL).replace(/\/+$/, "");
    this.name = options.model ?? LLM_MODEL;
    this.timeoutMs = options.timeoutMs ?? LLM_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(request: ModelRequest): Promise<ModelMessage> {
    if (!this.apiKey) {
      throw new LlmError(
        "llm_not_configured",
        "DEEPSEEK_API_KEY is not configured"
      );
    }
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new LlmError(
        "llm_not_configured",
        "AKER_LLM_TIMEOUT_MS must be a positive number"
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      const body: Record<string, unknown> = {
        model: this.name,
        messages: request.messages,
        response_format: request.jsonMode ? { type: "json_object" } : undefined,
        temperature: 0.1,
      };
      if (request.tools.length > 0) {
        body.tools = request.tools;
        body.tool_choice = "auto";
      }
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LlmError("llm_timeout", "DeepSeek request timed out");
      }
      throw new LlmError(
        "llm_provider_error",
        error instanceof Error ? error.message : "DeepSeek request failed"
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      await logProviderError(response);
      if (response.status === 401 || response.status === 403) {
        throw new LlmError("llm_auth_failed", "DeepSeek authentication failed", response.status);
      }
      if (response.status === 429) {
        throw new LlmError("llm_rate_limited", "DeepSeek rate limit exceeded", response.status);
      }
      throw new LlmError(
        "llm_provider_error",
        `DeepSeek request failed with status ${response.status}`,
        response.status
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new LlmError("llm_invalid_response", "DeepSeek returned invalid JSON");
    }
    return parseMessage(payload);
  }
}
