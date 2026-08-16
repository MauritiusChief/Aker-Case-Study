/**
 * Walkthrough note: Shared bounded state machine for investigation, citations,
 * widget transactions, dynamic budget control, and terminal submission.
 */
import { randomUUID } from "node:crypto";
import { stringify as stringifyYaml } from "yaml";
import {
  LlmError,
  type AgentSecurityEvent,
  type AssistantToolName,
  type BriefFacts,
  type ChatModel,
  type ModelMessage,
  type ModelTool,
  type ModelToolCall,
  type WidgetOperation,
} from "./assistant-types.js";
import {
  isAssistantToolName,
  type ToolExecutor,
} from "./assistant-tools.js";
import {
  isWidgetToolName,
  WidgetDraftStore,
} from "./widget-tools.js";
import { AKER_LLM_DEBUG } from "./config.js";

export interface GroundedAgentConfig {
  maxModelAttempts: number;
  maxToolRounds: number;
  maxRealToolCalls: number;
  maxWidgetToolCalls: number;
}

export interface GroundedAgentOptions {
  model: ChatModel;
  systemPrompt: string;
  task: string;
  facts: BriefFacts;
  tools: ModelTool[];
  widgetTools: ModelTool[];
  widgetDraft: WidgetDraftStore;
  buildSubmissionTool: (sourceIds: string[]) => ModelTool;
  executeTool: ToolExecutor;
  extraContext?: Record<string, unknown>;
  config: GroundedAgentConfig;
}

export interface GroundedAgentResult {
  submission: Record<string, unknown>;
  widgets: import("./assistant-types.js").SemanticWidget[];
  widgetOperations: WidgetOperation[];
  sources: Record<string, unknown>;
  toolCalls: number;
  toolRounds: number;
  widgetToolCalls: number;
  modelAttempts: number;
  securityEvents: AgentSecurityEvent[];
}

function debugLog(...parts: unknown[]): void {
  if (AKER_LLM_DEBUG) console.log("[grounded-agent]", ...parts);
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

function yaml(value: unknown): string {
  return stringifyYaml(value).trimEnd();
}

function budgetContent(
  remainingToolCalls: number,
  remainingToolRounds: number,
  remainingWidgetCalls: number,
  totalToolCalls: number
): string {
  const canContinue = remainingToolRounds > 0 && remainingToolCalls > 0;
  return yaml({
    source: "application_control",
    remaining_tool_calls: remainingToolCalls,
    remaining_tool_rounds: remainingToolRounds,
    remaining_widget_calls: remainingWidgetCalls,
    total_tool_calls: totalToolCalls,
    instruction: canContinue || remainingWidgetCalls > 0
      ? "Continue with available data or widget tools, or call the submission tool when the grounded text is ready. Submission is terminal."
      : "Investigation and widget budgets are complete. Call the submission tool.",
  });
}

function invalid(message: string): never {
  throw new LlmError("llm_invalid_response", message);
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
    widgetTools,
    buildSubmissionTool,
    executeTool,
    config,
  } = options;
  const extraContext = options.extraContext ?? {};
  const runId = randomUUID();
  const securityEvents: AgentSecurityEvent[] = [];
  const sources = new Map<string, unknown>([["brief_facts", facts]]);
  let widgetDraft = options.widgetDraft;
  const businessToolNames = new Set(tools.map((tool) => tool.function.name));

  const messages: ModelMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `${task}\n\nInitial citable source brief_facts:\n${yaml(facts)}${
        Object.keys(extraContext).length
          ? `\n\nAdditional non-citable context:\n${yaml(extraContext)}`
          : ""
      }`,
    },
  ];
  // This transcript is run-local and is not returned as conversation memory.
  // Callers receive submission/source/widget metadata, while full provider
  // exchanges may separately be written to diagnostic traces.

  let modelAttempts = 0;
  let toolRounds = 0;
  let realToolCalls = 0;
  let widgetToolCalls = 0;
  let injectionIndex = 0;

  const createBudgetInfoCall = (): ModelToolCall => {
    injectionIndex += 1;
    return {
      id: `_budget_info_${runId}_${injectionIndex}`,
      type: "function",
      function: { name: "_budget_info", arguments: "{}" },
    };
  };

  const stripHallucinatedBudgetInfo = (response: ModelMessage): void => {
    const rawCalls = response.tool_calls ?? [];
    const hallucinated = rawCalls.filter((call) => call.function.name === "_budget_info");
    if (hallucinated.length > 0) {
      securityEvents.push({ type: "budget_info_hallucination", count: hallucinated.length });
      debugLog("stripped hallucinated _budget_info calls", hallucinated.length);
    }
    response.tool_calls = rawCalls.filter((call) => call.function.name !== "_budget_info");
  };

  while (true) {
    if (modelAttempts >= config.maxModelAttempts) {
      throw new LlmError(
        "llm_investigation_limit",
        "Model exceeded the bounded investigation limit"
      );
    }

    const remainingToolCalls = config.maxRealToolCalls - realToolCalls;
    const remainingToolRounds = config.maxToolRounds - toolRounds;
    const remainingWidgetCalls = config.maxWidgetToolCalls - widgetToolCalls;
    const submissionOnly =
      modelAttempts >= config.maxModelAttempts - 1 ||
      ((remainingToolCalls <= 0 || remainingToolRounds <= 0) && remainingWidgetCalls <= 0);
    const availableBusinessTools = remainingToolCalls > 0 && remainingToolRounds > 0 && !submissionOnly
      ? tools
      : [];
    const availableWidgetTools = remainingWidgetCalls > 0 && !submissionOnly ? widgetTools : [];
    const submissionTool = buildSubmissionTool([...sources.keys()]);
    const expectedSubmissionName = submissionTool.function.name;
    const requestTools = submissionOnly
      ? [submissionTool]
      : [...availableBusinessTools, ...availableWidgetTools, submissionTool];
    const openNames = new Set(requestTools.map((tool) => tool.function.name));

    debugLog(
      submissionOnly ? "phase=submission-only" : "phase=work",
      `modelAttempt=${modelAttempts + 1}`,
      `remainingCalls=${remainingToolCalls}`,
      `remainingRounds=${remainingToolRounds}`,
      `remainingWidgetCalls=${remainingWidgetCalls}`
    );
    const response = await model.complete({
      messages,
      tools: requestTools,
    });
    modelAttempts += 1;
    stripHallucinatedBudgetInfo(response);
    const calls = response.tool_calls ?? [];
    if (calls.length === 0) invalid("Model must respond with an available tool call");

    const seenIds = new Set<string>();
    for (const call of calls) {
      if (!call.id || call.id.trim() === "") invalid("Tool call is missing an id");
      if (seenIds.has(call.id)) {
        securityEvents.push({ type: "duplicate_tool_call_id", id: call.id });
        invalid("Tool call ids must be unique within a round");
      }
      seenIds.add(call.id);
      if (!openNames.has(call.function.name)) {
        securityEvents.push({ type: "unknown_tool", name: call.function.name });
        invalid(`Tool is not available in this scope: ${call.function.name}`);
      }
    }

    const submissionCalls = calls.filter(
      (call) => call.function.name === expectedSubmissionName
    );
    if (submissionCalls.length > 1) invalid("Only one submission tool call is allowed");

    if (submissionCalls.length === 1) {
      // A submission is the terminal transition. Validated widget mutations
      // may commit atomically, while same-response reads/business calls cannot
      // race with or alter the submitted result.
      const submission = parseArgumentsObject(submissionCalls[0].function.arguments);
      const discardedBusiness = calls.filter((call) => businessToolNames.has(call.function.name));
      const widgetMutations = calls.filter(
        (call) => isWidgetToolName(call.function.name) && call.function.name !== "get_widgets"
      );
      const discardedReads = calls.filter((call) => call.function.name === "get_widgets");
      const discardedCount = discardedBusiness.length + discardedReads.length;
      if (discardedCount > 0) {
        securityEvents.push({ type: "discarded_tool_calls_on_submit", count: discardedCount });
      }
      if (widgetMutations.length > remainingWidgetCalls) {
        securityEvents.push({
          type: "budget_exceeded",
          requested: widgetMutations.length,
          remaining: remainingWidgetCalls,
        });
        throw new LlmError(
          "llm_investigation_limit",
          "Model requested more widget mutations than the remaining widget budget"
        );
      }
      const candidateDraft = widgetDraft.clone();
      try {
        for (const call of widgetMutations) {
          candidateDraft.execute(call.function.name as import("./assistant-types.js").WidgetToolName, call.function.arguments);
        }
      } catch (error) {
        invalid(error instanceof Error ? error.message : "Widget mutation failed");
      }
      widgetDraft = candidateDraft;
      widgetToolCalls += widgetMutations.length;
      debugLog(
        "submission accepted",
        `name=${expectedSubmissionName}`,
        `discarded=${discardedCount}`,
        `widgetMutations=${widgetMutations.length}`
      );
      return {
        submission,
        widgets: widgetDraft.state(),
        widgetOperations: widgetDraft.operationLog(),
        sources: Object.fromEntries(sources),
        toolCalls: realToolCalls,
        toolRounds,
        widgetToolCalls,
        modelAttempts,
        securityEvents,
      };
    }

    if (submissionOnly) invalid(`Model must call ${expectedSubmissionName}`);

    const businessCalls = calls.filter((call) => isAssistantToolName(call.function.name));
    const widgetCalls = calls.filter((call) => isWidgetToolName(call.function.name));
    if (businessCalls.length + widgetCalls.length !== calls.length) {
      invalid("Model returned an unsupported tool call");
    }
    if (businessCalls.length > remainingToolCalls) {
      securityEvents.push({
        type: "budget_exceeded",
        requested: businessCalls.length,
        remaining: remainingToolCalls,
      });
      throw new LlmError(
        "llm_investigation_limit",
        "Model requested more tools than the remaining investigation budget"
      );
    }
    if (widgetCalls.length > remainingWidgetCalls) {
      securityEvents.push({
        type: "budget_exceeded",
        requested: widgetCalls.length,
        remaining: remainingWidgetCalls,
      });
      throw new LlmError(
        "llm_investigation_limit",
        "Model requested more widget tools than the remaining widget budget"
      );
    }
    for (const call of businessCalls) parseArgumentsObject(call.function.arguments);

    const candidateDraft = widgetDraft.clone();
    const widgetResults = new Map<string, unknown>();
    try {
      for (const call of widgetCalls) {
        widgetResults.set(
          call.id,
          candidateDraft.execute(call.function.name as import("./assistant-types.js").WidgetToolName, call.function.arguments)
        );
      }
    } catch (error) {
      invalid(error instanceof Error ? error.message : "Widget tool execution failed");
    }

    if (businessCalls.length > 0) toolRounds += 1;
    widgetToolCalls += widgetCalls.length;
    // Budget is injected as a virtual tool exchange so its changing value has
    // the right place in message time. Putting it only in the system prompt
    // would make a dynamic value look fixed before the conversation began.
    const budgetCall = createBudgetInfoCall();
    messages.push({
      role: "assistant",
      content: response.content,
      ...(response.reasoning_content === undefined
        ? {}
        : { reasoning_content: response.reasoning_content }),
      tool_calls: [...calls, budgetCall],
    });

    for (const call of calls) {
      if (isAssistantToolName(call.function.name)) {
        let result: unknown;
        try {
          result = executeTool(call.function.name as AssistantToolName, call.function.arguments);
        } catch (error) {
          invalid(error instanceof Error ? error.message : "Tool execution failed");
        }
        realToolCalls += 1;
        const sourceId = `tool_${realToolCalls}`;
        sources.set(sourceId, result);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Source id: ${sourceId}\nSource value (citation paths are relative to this value):\n${yaml(result)}`,
        });
        debugLog("tool executed", `source=${sourceId}`, `name=${call.function.name}`);
      } else {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Non-citable widget draft result:\n${yaml(widgetResults.get(call.id))}`,
        });
      }
    }
    widgetDraft = candidateDraft;

    const nextRemainingCalls = config.maxRealToolCalls - realToolCalls;
    const nextRemainingRounds = config.maxToolRounds - toolRounds;
    const nextRemainingWidgetCalls = config.maxWidgetToolCalls - widgetToolCalls;
    messages.push({
      role: "tool",
      tool_call_id: budgetCall.id,
      content: budgetContent(
        nextRemainingCalls,
        nextRemainingCalls <= 0 ? 0 : nextRemainingRounds,
        nextRemainingWidgetCalls,
        realToolCalls
      ),
    });
  }
}
