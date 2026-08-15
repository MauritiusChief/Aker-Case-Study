import { test } from "node:test";
import assert from "node:assert/strict";
import { parse as parseYaml } from "yaml";
import {
  runGroundedAgent,
  type GroundedAgentConfig,
} from "../src/grounded-agent.js";
import {
  LlmError,
  type AssistantToolName,
  type BriefFacts,
  type ModelMessage,
  type ModelRequest,
  type ModelTool,
} from "../src/assistant-types.js";

const facts: BriefFacts = {
  as_of_date: "2026/02/25",
  month_year: "2026/02",
  scope: {
    kind: "candidate_and_portfolio_comparison",
    candidate_property_codes: ["P1"],
    portfolio_property_codes: ["P1"],
  },
  portfolio: {
    total_properties: 1,
    total_units: 10,
    physical_occupancy_pct: 80,
    leased_pct: 80,
    available_units: 2,
    vacant_unrented_exposure: 3_000,
    expiring_60_days: 1,
    total_loss_to_lease: 400,
    positive_loss_to_lease_count: 2,
  },
  coverage: { market_rent_coverage: 100 },
  data_quality: { error_count: 0, warning_count: 0, by_code: [] },
  properties: [],
  candidates: [],
  limitations: [],
};

const availabilityTool: ModelTool = {
  type: "function",
  function: { name: "get_availability", description: "read availability", parameters: {} },
};

const defaultConfig: GroundedAgentConfig = {
  maxModelAttempts: 6,
  maxToolRounds: 4,
  maxRealToolCalls: 8,
};

function call(id: string, name: string, args = "{}"): ModelMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
  };
}

function calls(items: Array<[string, string]>): ModelMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: items.map(([id, name]) => ({
      id,
      type: "function",
      function: { name, arguments: "{}" },
    })),
  };
}

function content(text: string): ModelMessage {
  return { role: "assistant", content: text };
}

class RecordingModel {
  readonly name = "fake-model";
  private index = 0;
  readonly requests: ModelRequest[] = [];
  constructor(private readonly responses: ModelMessage[]) {}
  async complete(request: ModelRequest): Promise<ModelMessage> {
    this.requests.push({
      messages: [...request.messages],
      tools: [...request.tools],
      jsonMode: request.jsonMode,
    });
    const response = this.responses[this.index++];
    if (!response) throw new Error("No fake response left");
    return response;
  }
}

function run(
  responses: ModelMessage[],
  tools: ModelTool[],
  config: GroundedAgentConfig = defaultConfig,
  executeTool: (name: AssistantToolName) => unknown = () => ({ ok: true }),
  extraContext: Record<string, unknown> = {}
) {
  const model = new RecordingModel(responses);
  return {
    model,
    promise: runGroundedAgent({
      model,
      systemPrompt: "system",
      task: "task",
      facts,
      tools,
      executeTool: (name) => executeTool(name),
      extraContext,
      config,
    }),
  };
}

function budgetToolMessages(messages: ModelMessage[]): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === "tool" && message.tool_call_id?.startsWith("_budget_info")) {
      result.push(parseYaml(message.content as string) as Record<string, unknown>);
    }
  }
  return result;
}

test("serializes structured model inputs as YAML and keeps tool arguments as JSON", async () => {
  const argumentsJson = '{"property_code":"P1"}';
  const { model, promise } = run(
    [call("c1", "get_availability", argumentsJson), content("final")],
    [availabilityTool],
    defaultConfig,
    () => ({ available: 2, labels: ["ready", "vacant"] }),
    { note: "line one\nline two" }
  );
  await promise;

  const initialContent = model.requests[0].messages[1].content as string;
  assert.match(initialContent, /Initial citable source brief_facts:\nas_of_date: 2026\/02\/25/);
  assert.match(initialContent, /Additional non-citable context:\nnote: \|-/);
  assert.doesNotMatch(initialContent, /"as_of_date":/);

  const nextMessages = model.requests[1].messages;
  const assistantCall = nextMessages.find((message) =>
    message.role === "assistant" && message.tool_calls?.some((toolCall) => toolCall.id === "c1")
  );
  const preservedArguments = assistantCall?.tool_calls?.find((toolCall) => toolCall.id === "c1");
  assert.equal(preservedArguments?.function.arguments, argumentsJson);

  const toolResult = nextMessages.find((message) => message.tool_call_id === "c1");
  assert.match(toolResult?.content ?? "", /Source value .*:\navailable: 2\nlabels:\n  - ready\n  - vacant/);
  assert.doesNotMatch(toolResult?.content ?? "", /"available":/);

  const budgetResult = nextMessages.find((message) =>
    message.role === "tool" && message.tool_call_id?.startsWith("_budget_info")
  );
  assert.match(budgetResult?.content ?? "", /^source: application_control\n/);
  assert.equal(parseYaml(budgetResult?.content as string).remaining_tool_calls, 7);
});

function budgetCallIds(messages: ModelMessage[]): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    if (message.role === "assistant" && message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.function.name === "_budget_info") ids.push(toolCall.id);
      }
    }
  }
  return ids;
}

test("investigates four tool rounds then finalizes with an empty tool request", async () => {
  const executed: string[] = [];
  const { model, promise } = run(
    [
      call("c1", "get_availability"),
      call("c2", "get_availability"),
      call("c3", "get_availability"),
      call("c4", "get_availability"),
      content("final"),
    ],
    [availabilityTool],
    defaultConfig,
    (name) => {
      executed.push(name);
      return { available: 2 };
    }
  );
  const result = await promise;

  assert.equal(result.toolCalls, 4);
  assert.equal(result.toolRounds, 4);
  assert.equal(result.modelAttempts, 5);
  assert.equal(result.content, "final");
  assert.deepEqual(executed, [
    "get_availability",
    "get_availability",
    "get_availability",
    "get_availability",
  ]);
  assert.deepEqual(Object.keys(result.sources), ["brief_facts", "tool_1", "tool_2", "tool_3", "tool_4"]);

  const finalRequest = model.requests[4];
  assert.equal(finalRequest.tools.length, 0);
  assert.equal(finalRequest.jsonMode, true);
});

test("injects matching _budget_info pairs with unique call ids", async () => {
  const { model, promise } = run(
    [
      call("c1", "get_availability"),
      call("c2", "get_availability"),
      content("final"),
    ],
    [availabilityTool]
  );
  await promise;

  const finalMessages = model.requests[model.requests.length - 1].messages;
  const ids = budgetCallIds(finalMessages);
  const toolResultIds = finalMessages
    .filter((message) => message.role === "tool" && message.tool_call_id?.startsWith("_budget_info"))
    .map((message) => message.tool_call_id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 2);
  assert.deepEqual(toolResultIds, ids);
});

test("budget info does not count toward real tool calls or sources", async () => {
  const { promise } = run(
    [
      call("c1", "get_availability"),
      call("c2", "get_availability"),
      content("final"),
    ],
    [availabilityTool]
  );
  const result = await promise;

  assert.equal(result.toolCalls, 2);
  assert.equal(Object.keys(result.sources).length, 3);
  assert.ok(!Object.keys(result.sources).includes("_budget_info"));
  for (const key of Object.keys(result.sources)) {
    assert.ok(!key.startsWith("_budget_info"));
  }
});

test("injects remaining_tool_rounds 0 after the fourth tool round", async () => {
  const { model, promise } = run(
    [
      call("c1", "get_availability"),
      call("c2", "get_availability"),
      call("c3", "get_availability"),
      call("c4", "get_availability"),
      content("final"),
    ],
    [availabilityTool]
  );
  await promise;

  const finalRequest = model.requests[4];
  const budgetMessages = budgetToolMessages(finalRequest.messages);
  const lastBudget = budgetMessages[budgetMessages.length - 1];
  assert.equal(lastBudget?.remaining_tool_rounds, 0);
  assert.equal(lastBudget?.source, "application_control");
});

test("multiple real tools in one response only advance one tool round", async () => {
  const { promise } = run(
    [
      calls([["c1", "get_availability"], ["c2", "get_availability"]]),
      content("final"),
    ],
    [availabilityTool]
  );
  const result = await promise;
  assert.equal(result.toolRounds, 1);
  assert.equal(result.toolCalls, 2);
});

test("exactly eight real tool calls are allowed", async () => {
  const { promise } = run(
    [
      calls([["c1", "get_availability"], ["c2", "get_availability"]]),
      calls([["c3", "get_availability"], ["c4", "get_availability"]]),
      calls([["c5", "get_availability"], ["c6", "get_availability"]]),
      calls([["c7", "get_availability"], ["c8", "get_availability"]]),
      content("final"),
    ],
    [availabilityTool]
  );
  const result = await promise;
  assert.equal(result.toolCalls, 8);
  assert.equal(result.content, "final");
});

test("a ninth real tool call is rejected before execution", async () => {
  const executed: string[] = [];
  const { promise } = run(
    [calls([
      ["c1", "get_availability"], ["c2", "get_availability"],
      ["c3", "get_availability"], ["c4", "get_availability"],
      ["c5", "get_availability"], ["c6", "get_availability"],
      ["c7", "get_availability"], ["c8", "get_availability"],
      ["c9", "get_availability"],
    ])],
    [availabilityTool],
    defaultConfig,
    (name) => {
      executed.push(name);
      return { ok: true };
    }
  );
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof LlmError && error.code === "llm_investigation_limit"
  );
  assert.equal(executed.length, 0);
});

test("a round exceeding the remaining budget does not partially execute", async () => {
  const executed: string[] = [];
  const { promise } = run(
    [
      calls([["c1", "get_availability"], ["c2", "get_availability"]]),
      calls([["c3", "get_availability"], ["c4", "get_availability"]]),
    ],
    [availabilityTool],
    { maxModelAttempts: 6, maxToolRounds: 4, maxRealToolCalls: 3 },
    (name) => {
      executed.push(name);
      return { ok: true };
    }
  );
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof LlmError && error.code === "llm_investigation_limit"
  );
  assert.equal(executed.length, 2);
});

test("unknown and unopened tools are never executed", async () => {
  const executed: string[] = [];
  const unknown = run(
    [call("c1", "totally_unknown_tool")],
    [availabilityTool],
    defaultConfig,
    (name) => {
      executed.push(name);
      return { ok: true };
    }
  );
  await assert.rejects(
    unknown.promise,
    (error: unknown) => error instanceof LlmError && error.code === "llm_invalid_response"
  );
  assert.equal(executed.length, 0);

  const unopened = run(
    [call("c1", "get_property_summary")],
    [availabilityTool],
    defaultConfig,
    (name) => {
      executed.push(name);
      return { ok: true };
    }
  );
  await assert.rejects(
    unopened.promise,
    (error: unknown) => error instanceof LlmError && error.code === "llm_invalid_response"
  );
  assert.equal(executed.length, 0);
});

test("duplicate tool call ids within a round are rejected", async () => {
  const { promise } = run(
    [calls([["dup", "get_availability"], ["dup", "get_availability"]])],
    [availabilityTool]
  );
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof LlmError && error.code === "llm_invalid_response"
  );
});

test("mixed real and hallucinated _budget_info calls only execute the real tools", async () => {
  const executed: string[] = [];
  const { promise } = run(
    [
      calls([["c1", "get_availability"], ["fake", "_budget_info"]]),
      content("final"),
    ],
    [availabilityTool],
    defaultConfig,
    (name) => {
      executed.push(name);
      return { ok: true };
    }
  );
  const result = await promise;
  assert.deepEqual(executed, ["get_availability"]);
  assert.equal(result.content, "final");
  assert.equal(result.toolCalls, 1);
});

test("content accompanied by hallucinated _budget_info is still validated", async () => {
  const response: ModelMessage = {
    role: "assistant",
    content: "final",
    tool_calls: [{ id: "fake", type: "function", function: { name: "_budget_info", arguments: "{}" } }],
  };
  const { promise } = run([response], [availabilityTool]);
  const result = await promise;
  assert.equal(result.content, "final");
  assert.equal(result.toolCalls, 0);
});

test("a lone hallucinated _budget_info recovers at most once", async () => {
  const budgetOnly: ModelMessage = {
    role: "assistant",
    content: null,
    tool_calls: [{ id: "fake", type: "function", function: { name: "_budget_info", arguments: "{}" } }],
  };
  const recovered = run([budgetOnly, content("final")], [availabilityTool]);
  const result = await recovered.promise;
  assert.equal(result.content, "final");

  const twice = run([budgetOnly, budgetOnly], [availabilityTool]);
  await assert.rejects(
    twice.promise,
    (error: unknown) => error instanceof LlmError && error.code === "llm_invalid_response"
  );
});

test("fails explicitly once model attempts are exhausted", async () => {
  const { promise } = run(
    [call("c1", "get_availability")],
    [availabilityTool],
    { maxModelAttempts: 1, maxToolRounds: 4, maxRealToolCalls: 8 }
  );
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof LlmError && error.code === "llm_investigation_limit"
  );
});

test("premature final content does not trigger an extra finalization request", async () => {
  const { model, promise } = run([content("done-early")], [availabilityTool]);
  const result = await promise;
  assert.equal(result.content, "done-early");
  assert.equal(model.requests.length, 1);
  assert.equal(model.requests[0].tools.length, 1);
});

test("passes provider reasoning content back with the next tool request", async () => {
  const firstResponse = call("c1", "get_availability");
  firstResponse.reasoning_content = "provider reasoning";
  const { model, promise } = run(
    [firstResponse, content("final")],
    [availabilityTool]
  );
  await promise;
  const priorAssistant = model.requests[1].messages.find(
    (message) =>
      message.role === "assistant" &&
      message.tool_calls?.some((toolCall) => toolCall.id === "c1")
  );
  assert.equal(priorAssistant?.reasoning_content, "provider reasoning");
  assert.ok(
    priorAssistant?.tool_calls?.some(
      (toolCall) => toolCall.function.name === "_budget_info"
    )
  );
});

test("finalization request omits tools while investigation requests include them", async () => {
  const { model, promise } = run(
    [
      call("c1", "get_availability"),
      call("c2", "get_availability"),
      call("c3", "get_availability"),
      call("c4", "get_availability"),
      content("final"),
    ],
    [availabilityTool]
  );
  await promise;
  assert.equal(model.requests[0].tools.length, 1);
  assert.equal(model.requests[4].tools.length, 0);
});
