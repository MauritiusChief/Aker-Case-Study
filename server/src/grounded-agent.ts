import { randomUUID } from "node:crypto";
import {
  LlmError,
  type AgentSecurityEvent,
  type AssistantToolName,
  type BriefFacts,
  type ChatModel,
  type ModelMessage,
  type ModelTool,
  type ModelToolCall,
} from "./assistant-types.js";
import {
  isAssistantToolName,
  type ToolExecutor,
} from "./assistant-tools.js";
import { AKER_LLM_DEBUG } from "./config.js";

export interface GroundedAgentConfig {
  maxModelAttempts: number;
  maxToolRounds: number;
  maxRealToolCalls: number;
}

export interface GroundedAgentOptions {
  model: ChatModel;
  systemPrompt: string;
  task: string;
  facts: BriefFacts;
  tools: ModelTool[];
  executeTool: ToolExecutor;
  extraContext?: Record<string, unknown>;
  config: GroundedAgentConfig;
}

export interface GroundedAgentResult {
  content: string;
  sources: Record<string, unknown>;
  toolCalls: number;
  toolRounds: number;
  modelAttempts: number;
  securityEvents: AgentSecurityEvent[];
}

function debugLog(...parts: unknown[]): void {
  if (AKER_LLM_DEBUG) {
    console.log("[grounded-agent]", ...parts);
  }
}

function parseArgumentsObject(argumentsJson: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(argumentsJson);
  } catch {
    throw new LlmError("llm_invalid_response", "Tool arguments must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LlmError("llm_invalid_response", "Tool arguments must be an object");
  }
  return value as Record<string, unknown>;
}

function budgetContent(
  remainingToolCalls: number,
  remainingToolRounds: number,
  totalToolCalls: number
): string {
  return JSON.stringify({
    source: "application_control",
    remaining_tool_calls: remainingToolCalls,
    remaining_tool_rounds: remainingToolRounds,
    total_tool_calls: totalToolCalls,
    instruction:
      remainingToolRounds > 0
        ? "Plan further investigation within this budget."
        : "Investigation is complete. Produce the final JSON response without additional tools.",
  });
}

export async function runGroundedAgent(
  options: GroundedAgentOptions
): Promise<GroundedAgentResult> {
  const {
    model,
    systemPrompt,
    task,
    facts,
    tools,
    executeTool,
    config,
  } = options;
  const extraContext = options.extraContext ?? {};
  const runId = randomUUID();
  const securityEvents: AgentSecurityEvent[] = [];
  const sources = new Map<string, unknown>([["brief_facts", facts]]);
  const openToolNames = new Set(tools.map((tool) => tool.function.name));

  const messages: ModelMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `${task}\n\nInitial citable source brief_facts:\n${JSON.stringify(facts)}${
        Object.keys(extraContext).length
          ? `\n\nAdditional non-citable context:\n${JSON.stringify(extraContext)}`
          : ""
      }`,
    },
  ];

  let modelAttempts = 0;
  let toolRounds = 0;
  let realToolCalls = 0;
  let emptyResponses = 0;
  let injectionIndex = 0;
  let lastInjectedRoundsRemaining: number | null = null;

  const injectBudgetInfo = (
    remainingToolCalls: number,
    remainingToolRounds: number
  ): void => {
    injectionIndex += 1;
    const callId = `_budget_info_${runId}_${injectionIndex}`;
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: callId,
          type: "function",
          function: { name: "_budget_info", arguments: "{}" },
        },
      ],
    });
    messages.push({
      role: "tool",
      tool_call_id: callId,
      content: budgetContent(
        remainingToolCalls,
        remainingToolRounds,
        config.maxRealToolCalls
      ),
    });
  };

  const stripHallucinatedBudgetInfo = (response: ModelMessage): void => {
    const rawCalls = response.tool_calls ?? [];
    const hallucinated = rawCalls.filter(
      (call) => call.function.name === "_budget_info"
    );
    if (hallucinated.length > 0) {
      securityEvents.push({
        type: "budget_info_hallucination",
        count: hallucinated.length,
      });
      debugLog(
        "stripped hallucinated _budget_info calls",
        hallucinated.length
      );
    }
    response.tool_calls = rawCalls.filter(
      (call) => call.function.name !== "_budget_info"
    );
  };

  const finalize = async (): Promise<GroundedAgentResult> => {
    if (lastInjectedRoundsRemaining === null || lastInjectedRoundsRemaining > 0) {
      injectBudgetInfo(
        config.maxRealToolCalls - realToolCalls,
        0
      );
      lastInjectedRoundsRemaining = 0;
    }
    if (modelAttempts >= config.maxModelAttempts) {
      throw new LlmError(
        "llm_investigation_limit",
        "Model exceeded the bounded investigation limit"
      );
    }
    debugLog("phase=finalize", `modelAttempt=${modelAttempts + 1}`, "tools=[]");
    const response = await model.complete({ messages, tools: [], jsonMode: true });
    modelAttempts += 1;
    stripHallucinatedBudgetInfo(response);
    if (!response.content || response.content.trim() === "") {
      throw new LlmError(
        "llm_invalid_response",
        "Model returned neither content nor tool calls"
      );
    }
    debugLog(
      "finalize complete",
      `finish_reason=${response.finish_reason ?? ""}`,
      `has_content=${Boolean(response.content)}`
    );
    return {
      content: response.content,
      sources: Object.fromEntries(sources),
      toolCalls: realToolCalls,
      toolRounds,
      modelAttempts,
      securityEvents,
    };
  };

  while (true) {
    const remainingToolCalls = config.maxRealToolCalls - realToolCalls;
    const remainingToolRounds = config.maxToolRounds - toolRounds;
    if (remainingToolRounds <= 0 || remainingToolCalls <= 0) {
      return await finalize();
    }

    if (modelAttempts >= config.maxModelAttempts) {
      throw new LlmError(
        "llm_investigation_limit",
        "Model exceeded the bounded investigation limit"
      );
    }

    debugLog(
      "phase=investigate",
      `modelAttempt=${modelAttempts + 1}`,
      `remainingCalls=${remainingToolCalls}`,
      `remainingRounds=${remainingToolRounds}`
    );
    const response = await model.complete({ messages, tools, jsonMode: true });
    modelAttempts += 1;
    debugLog(
      "model response",
      `finish_reason=${response.finish_reason ?? ""}`,
      `has_content=${Boolean(response.content)}`
    );

    stripHallucinatedBudgetInfo(response);
    const realCalls = response.tool_calls ?? [];

    if (realCalls.length === 0) {
      if (response.content && response.content.trim() !== "") {
        return {
          content: response.content,
          sources: Object.fromEntries(sources),
          toolCalls: realToolCalls,
          toolRounds,
          modelAttempts,
          securityEvents,
        };
      }
      emptyResponses += 1;
      debugLog("empty response", `emptyResponses=${emptyResponses}`);
      if (emptyResponses > 1) {
        throw new LlmError(
          "llm_invalid_response",
          "Model returned empty responses without final content"
        );
      }
      continue;
    }

    emptyResponses = 0;

    if (realCalls.length > remainingToolCalls) {
      securityEvents.push({
        type: "budget_exceeded",
        requested: realCalls.length,
        remaining: remainingToolCalls,
      });
      throw new LlmError(
        "llm_investigation_limit",
        "Model requested more tools than the remaining investigation budget"
      );
    }

    const seenIds = new Set<string>();
    for (const call of realCalls) {
      if (!call.id || call.id.trim() === "") {
        throw new LlmError("llm_invalid_response", "Tool call is missing an id");
      }
      if (seenIds.has(call.id)) {
        securityEvents.push({ type: "duplicate_tool_call_id", id: call.id });
        throw new LlmError(
          "llm_invalid_response",
          "Tool call ids must be unique within a round"
        );
      }
      seenIds.add(call.id);
      const name = call.function.name;
      if (!isAssistantToolName(name)) {
        securityEvents.push({ type: "unknown_tool", name });
        throw new LlmError("llm_invalid_response", `Unknown tool: ${name}`);
      }
      if (!openToolNames.has(name)) {
        securityEvents.push({ type: "unknown_tool", name });
        throw new LlmError(
          "llm_invalid_response",
          `Tool is not available in this scope: ${name}`
        );
      }
      parseArgumentsObject(call.function.arguments);
    }

    toolRounds += 1;
    debugLog(
      "tool round",
      `round=${toolRounds}`,
      "tools=" + realCalls.map((call) => call.function.name).join(",")
    );
    messages.push({
      role: "assistant",
      content: response.content,
      tool_calls: realCalls,
    });

    for (const call of realCalls) {
      const startedAt = Date.now();
      let result: unknown;
      try {
        result = executeTool(
          call.function.name as AssistantToolName,
          call.function.arguments
        );
      } catch (error) {
        throw new LlmError(
          "llm_invalid_response",
          error instanceof Error ? error.message : "Tool execution failed"
        );
      }
      realToolCalls += 1;
      const sourceId = `tool_${realToolCalls}`;
      sources.set(sourceId, result);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: `Source id: ${sourceId}\nSource value (citation paths are relative to this value):\n${JSON.stringify(result)}`,
      });
      debugLog(
        "tool executed",
        `source=${sourceId}`,
        `name=${call.function.name}`,
        `ms=${Date.now() - startedAt}`
      );
    }

    const newRemainingCalls = config.maxRealToolCalls - realToolCalls;
    const newRemainingRounds = config.maxToolRounds - toolRounds;
    injectBudgetInfo(newRemainingCalls, newRemainingRounds);
    lastInjectedRoundsRemaining = newRemainingRounds;
    debugLog(
      "budget injected",
      `remainingCalls=${newRemainingCalls}`,
      `remainingRounds=${newRemainingRounds}`
    );
  }
}
