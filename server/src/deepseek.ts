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
import {
  createTraceId,
  type LlmTraceOutcome,
  type LlmTraceResponse,
  type LlmTraceWriter,
} from "./llm-trace.js";

interface DeepSeekOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  traceWriter?: LlmTraceWriter;
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

function logProviderError(status: number, payload?: unknown): void {
  if (!AKER_LLM_DEBUG) return;
  const error = payload && typeof payload === "object" && "error" in payload
    ? (payload as { error?: unknown }).error
    : undefined;
  if (!error || typeof error !== "object") {
    console.error("[deepseek] provider error", {
      status,
      detail: "The provider error body was not valid JSON",
    });
    return;
  }
  const details = error as Record<string, unknown>;
  const message = typeof details.message === "string"
    ? details.message.slice(0, 1_000)
    : undefined;
  console.error("[deepseek] provider error", {
    status,
    type: typeof details.type === "string" ? details.type : undefined,
    code: typeof details.code === "string" || typeof details.code === "number"
      ? details.code
      : undefined,
    param: typeof details.param === "string" ? details.param : undefined,
    message,
  });
}

function providerError(status: number): LlmError {
  if (status === 401 || status === 403) {
    return new LlmError("llm_auth_failed", "DeepSeek authentication failed", status);
  }
  if (status === 429) {
    return new LlmError("llm_rate_limited", "DeepSeek rate limit exceeded", status);
  }
  return new LlmError(
    "llm_provider_error",
    `DeepSeek request failed with status ${status}`,
    status
  );
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
  private readonly traceWriter?: LlmTraceWriter;

  constructor(options: DeepSeekOptions = {}) {
    this.apiKey = options.apiKey ?? DEEPSEEK_API_KEY;
    this.baseUrl = (options.baseUrl ?? DEEPSEEK_BASE_URL).replace(/\/+$/, "");
    this.name = options.model ?? LLM_MODEL;
    this.timeoutMs = options.timeoutMs ?? LLM_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.traceWriter = options.traceWriter;
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

    const endpoint = `${this.baseUrl}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.name,
      messages: request.messages,
      temperature: 0.1,
    };
    if (request.tools.length > 0) {
      body.tools = request.tools;
      const choice = request.toolChoice ?? "auto";
      if (
        typeof choice === "object" &&
        !request.tools.some((tool) => tool.function.name === choice.function.name)
      ) {
        throw new LlmError(
          "llm_invalid_response",
          `tool_choice references an unavailable tool: ${choice.function.name}`
        );
      }
      body.tool_choice = choice;
    } else if (request.toolChoice !== undefined) {
      throw new LlmError(
        "llm_invalid_response",
        "tool_choice cannot be provided without tools"
      );
    }
    const serializedBody = JSON.stringify(body);
    const requestSnapshot: unknown = JSON.parse(serializedBody);
    const traceId = createTraceId();
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const persistTrace = async (
      outcome: LlmTraceOutcome,
      capturedResponse: LlmTraceResponse | null,
      error: unknown = null
    ): Promise<void> => {
      if (!this.traceWriter) return;
      const completedAtMs = Date.now();
      try {
        await this.traceWriter.save({
          schemaVersion: 1,
          traceId,
          provider: "deepseek",
          endpoint,
          startedAt,
          completedAt: new Date(completedAtMs).toISOString(),
          durationMs: completedAtMs - startedAtMs,
          outcome,
          request: requestSnapshot,
          response: capturedResponse,
          error: error === null
            ? null
            : {
                code: error instanceof LlmError ? error.code : error instanceof Error
                  ? error.name
                  : "unknown_error",
                message: error instanceof Error ? error.message : String(error),
              },
        });
      } catch (traceError) {
        console.error("[deepseek] failed to save LLM trace", traceError);
      }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: serializedBody,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        const mapped = new LlmError("llm_timeout", "DeepSeek request timed out");
        await persistTrace("timeout", null, mapped);
        throw mapped;
      }
      const mapped = new LlmError(
        "llm_provider_error",
        error instanceof Error ? error.message : "DeepSeek request failed"
      );
      await persistTrace("network_error", null, mapped);
      throw mapped;
    } finally {
      clearTimeout(timer);
    }

    let rawText: string;
    try {
      rawText = await response.text();
    } catch (error) {
      const mapped = response.ok
        ? new LlmError("llm_invalid_response", "DeepSeek returned invalid JSON")
        : providerError(response.status);
      await persistTrace(
        response.ok ? "invalid_response" : "http_error",
        { httpStatus: response.status },
        mapped
      );
      throw mapped;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawText);
    } catch {
      if (!response.ok) {
        logProviderError(response.status);
        const mapped = providerError(response.status);
        await persistTrace(
          "http_error",
          { httpStatus: response.status, rawText },
          mapped
        );
        throw mapped;
      }
      const mapped = new LlmError("llm_invalid_response", "DeepSeek returned invalid JSON");
      await persistTrace(
        "invalid_json",
        { httpStatus: response.status, rawText },
        mapped
      );
      throw mapped;
    }

    const capturedResponse = { httpStatus: response.status, body: payload };
    if (!response.ok) {
      logProviderError(response.status, payload);
      const mapped = providerError(response.status);
      await persistTrace("http_error", capturedResponse, mapped);
      throw mapped;
    }

    let message: ModelMessage;
    try {
      message = parseMessage(payload);
    } catch (error) {
      await persistTrace("invalid_response", capturedResponse, error);
      throw error;
    }
    await persistTrace("success", capturedResponse);
    return message;
  }
}
