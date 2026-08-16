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
  type SemanticWidget,
} from "../src/assistant-types.js";
import { buildWidgetTools, WidgetDraftStore } from "../src/widget-tools.js";

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
  maxWidgetToolCalls: 8,
};

function responseCalls(items: Array<[string, string, string?]>): ModelMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: items.map(([id, name, args = "{}"]) => ({
      id,
      type: "function",
      function: { name, arguments: args },
    })),
  };
}

function call(id: string, name: string, args = "{}"): ModelMessage {
  return responseCalls([[id, name, args]]);
}

function submit(value: unknown = { ok: true }): ModelMessage {
  return call("submit", "submit_morning_brief", JSON.stringify(value));
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
    });
    const response = this.responses[this.index++];
    if (!response) throw new Error("No fake response left");
    return response;
  }
}

interface RunOptions {
  tools?: ModelTool[];
  config?: GroundedAgentConfig;
  executeTool?: (name: AssistantToolName) => unknown;
  extraContext?: Record<string, unknown>;
  initialWidgets?: SemanticWidget[];
  protectedWidgetIds?: string[];
}

function run(responses: ModelMessage[], options: RunOptions = {}) {
  const model = new RecordingModel(responses);
  const draft = new WidgetDraftStore(
    options.initialWidgets ?? [],
    ["P1"],
    new Set(options.protectedWidgetIds ?? [])
  );
  return {
    model,
    draft,
    promise: runGroundedAgent({
      model,
      systemPrompt: "system",
      task: "task",
      facts,
      tools: options.tools ?? [availabilityTool],
      widgetTools: buildWidgetTools(["P1"]),
      widgetDraft: draft,
      buildSubmissionTool: (sourceIds) => ({
        type: "function",
        function: {
          name: "submit_morning_brief",
          description: "submit",
          parameters: {
            type: "object",
            properties: { source_id: { type: "string", enum: sourceIds } },
            additionalProperties: true,
          },
        },
      }),
      executeTool: (name) => (options.executeTool ?? (() => ({ ok: true })))(name),
      extraContext: options.extraContext,
      config: options.config ?? defaultConfig,
    }),
  };
}

test("serializes facts and tool results as YAML while preserving JSON arguments", async () => {
  const argumentsJson = '{"property_code":"P1"}';
  const { model, promise } = run(
    [call("c1", "get_availability", argumentsJson), submit()],
    {
      executeTool: () => ({ available: 2, labels: ["ready", "vacant"] }),
      extraContext: { note: "line one\nline two" },
    }
  );
  await promise;

  const initial = model.requests[0].messages[1].content as string;
  assert.match(initial, /Initial citable source brief_facts:\nas_of_date: 2026\/02\/25/);
  assert.match(initial, /Additional non-citable context:\nnote: \|-/);

  const nextMessages = model.requests[1].messages;
  const assistantCall = nextMessages.find((message) =>
    message.role === "assistant" && message.tool_calls?.some((toolCall) => toolCall.id === "c1")
  );
  assert.equal(
    assistantCall?.tool_calls?.find((toolCall) => toolCall.id === "c1")?.function.arguments,
    argumentsJson
  );
  const toolResult = nextMessages.find((message) => message.tool_call_id === "c1");
  assert.match(toolResult?.content ?? "", /Source id: tool_1/);
  assert.match(toolResult?.content ?? "", /available: 2/);
});

test("rebuilds the submission source enum after business tools", async () => {
  const { model, promise } = run([
    call("c1", "get_availability"),
    submit({ source_id: "tool_1" }),
  ]);
  await promise;
  const submission = model.requests[1].tools.find(
    (tool) => tool.function.name === "submit_morning_brief"
  );
  const properties = submission?.function.parameters.properties as Record<string, unknown>;
  assert.deepEqual(properties.source_id, {
    type: "string",
    enum: ["brief_facts", "tool_1"],
  });
});

test("submit wins over same-response business tools without executing them", async () => {
  const executed: string[] = [];
  const { promise } = run([
    responseCalls([
      ["query", "get_availability"],
      ["submit", "submit_morning_brief", '{"ok":true}'],
    ]),
  ], {
    executeTool: (name) => {
      executed.push(name);
      return { ok: true };
    },
  });
  const result = await promise;
  assert.deepEqual(executed, []);
  assert.equal(result.toolCalls, 0);
  assert.deepEqual(Object.keys(result.sources), ["brief_facts"]);
  assert.deepEqual(result.securityEvents, [
    { type: "discarded_tool_calls_on_submit", count: 1 },
  ]);
});

test("atomically applies widget mutations returned with submission", async () => {
  const createArgs = JSON.stringify({
    widget: {
      id: "availability-p1",
      type: "availability",
      title: "P1 availability",
      scope: { level: "property", property_codes: ["P1"] },
    },
  });
  const { promise } = run([
    responseCalls([
      ["widget", "create_widget", createArgs],
      ["submit", "submit_morning_brief", '{"ok":true}'],
    ]),
  ]);
  const result = await promise;
  assert.equal(result.widgetToolCalls, 1);
  assert.equal(result.widgets[0]?.id, "availability-p1");
  assert.deepEqual(result.widgets[0]?.source_ids, ["brief_facts"]);
  assert.equal(result.widgetOperations[0]?.op, "upsert");
});

test("rejects terminal widget mutations against protected widgets", async () => {
  const existing: SemanticWidget = {
    id: "pinned",
    type: "kpi",
    title: "Pinned",
    scope: { level: "portfolio", property_codes: [] },
    source_ids: ["brief_facts"],
  };
  const updateArgs = JSON.stringify({
    widget_id: "pinned",
    changes: { title: "Changed" },
  });
  const { promise } = run([
    responseCalls([
      ["widget", "update_widget", updateArgs],
      ["submit", "submit_morning_brief", '{"ok":true}'],
    ]),
  ], { initialWidgets: [existing], protectedWidgetIds: ["pinned"] });
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof LlmError && error.code === "llm_invalid_response"
  );
});

test("rejects creating a protected widget id even when it is absent from the draft", async () => {
  const createArgs = JSON.stringify({
    widget: {
      id: "pinned",
      type: "kpi",
      title: "Replacement",
      scope: { level: "portfolio", property_codes: [] },
    },
  });
  const { promise } = run([
    responseCalls([
      ["widget", "create_widget", createArgs],
      ["submit", "submit_morning_brief", '{"ok":true}'],
    ]),
  ], { protectedWidgetIds: ["pinned"] });
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof LlmError && error.code === "llm_invalid_response"
  );
});

test("preserves existing widget sources and filters when only text is submitted", async () => {
  const existing: SemanticWidget = {
    id: "lease-risk",
    type: "lease_expirations",
    title: "Lease risk",
    scope: { level: "portfolio", property_codes: [] },
    source_ids: ["tool_old"],
    filters: { lease_bucket: "0_30" },
  };
  const { promise } = run([submit()], { initialWidgets: [existing] });
  const result = await promise;
  assert.deepEqual(result.widgets, [existing]);
});

test("preserves widget sources and filters during title-only updates", async () => {
  const existing: SemanticWidget = {
    id: "lease-risk",
    type: "lease_expirations",
    title: "Lease risk",
    scope: { level: "portfolio", property_codes: [] },
    source_ids: ["tool_old"],
    filters: { lease_bucket: "0_30" },
  };
  const updateArgs = JSON.stringify({
    widget_id: "lease-risk",
    changes: { title: "Updated lease risk" },
  });
  const { promise } = run([
    responseCalls([
      ["widget", "update_widget", updateArgs],
      ["submit", "submit_morning_brief", '{"ok":true}'],
    ]),
  ], { initialWidgets: [existing] });
  const result = await promise;
  assert.equal(result.widgets[0]?.title, "Updated lease risk");
  assert.deepEqual(result.widgets[0]?.source_ids, ["tool_old"]);
  assert.deepEqual(result.widgets[0]?.filters, { lease_bucket: "0_30" });
});

test("widget reads are non-citable and do not create sources", async () => {
  const existing: SemanticWidget = {
    id: "current",
    type: "kpi",
    title: "Current",
    scope: { level: "portfolio", property_codes: [] },
    source_ids: ["brief_facts"],
  };
  const { model, promise } = run([
    call("widgets", "get_widgets"),
    submit(),
  ], { initialWidgets: [existing] });
  const result = await promise;
  assert.deepEqual(Object.keys(result.sources), ["brief_facts"]);
  assert.equal(result.widgetToolCalls, 1);
  const widgetResult = model.requests[1].messages.find(
    (message) => message.tool_call_id === "widgets"
  );
  assert.match(widgetResult?.content ?? "", /^Non-citable widget draft result:/);
  assert.match(widgetResult?.content ?? "", /editable: true/);
});

test("ignores widget reads returned with submission", async () => {
  const { promise } = run([
    responseCalls([
      ["widgets", "get_widgets"],
      ["submit", "submit_morning_brief", '{"ok":true}'],
    ]),
  ]);
  const result = await promise;
  assert.equal(result.widgetToolCalls, 0);
  assert.deepEqual(result.securityEvents, [
    { type: "discarded_tool_calls_on_submit", count: 1 },
  ]);
});

test("rejects multiple submissions and ordinary content", async () => {
  const multiple = run([
    responseCalls([
      ["s1", "submit_morning_brief", "{}"],
      ["s2", "submit_morning_brief", "{}"],
    ]),
  ]);
  await assert.rejects(multiple.promise, (error: unknown) =>
    error instanceof LlmError && error.code === "llm_invalid_response"
  );

  const contentOnly = run([{ role: "assistant", content: "final text" }]);
  await assert.rejects(contentOnly.promise, (error: unknown) =>
    error instanceof LlmError && error.code === "llm_invalid_response"
  );
});

test("rejects malformed submission arguments", async () => {
  const { promise } = run([call("submit", "submit_morning_brief", "not-json")]);
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof LlmError && error.code === "llm_invalid_response"
  );
});

test("multiple business tools in one response consume one round", async () => {
  const { promise } = run([
    responseCalls([
      ["c1", "get_availability"],
      ["c2", "get_availability"],
    ]),
    submit(),
  ]);
  const result = await promise;
  assert.equal(result.toolRounds, 1);
  assert.equal(result.toolCalls, 2);
});

test("rejects a business round that exceeds the remaining budget before execution", async () => {
  const executed: string[] = [];
  const { promise } = run([
    responseCalls([
      ["c1", "get_availability"],
      ["c2", "get_availability"],
    ]),
  ], {
    config: { ...defaultConfig, maxRealToolCalls: 1 },
    executeTool: (name) => {
      executed.push(name);
      return {};
    },
  });
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof LlmError && error.code === "llm_investigation_limit"
  );
  assert.deepEqual(executed, []);
});

test("rejects unknown tools and duplicate call ids", async () => {
  const unknown = run([call("c1", "unknown_tool")]);
  await assert.rejects(unknown.promise, (error: unknown) =>
    error instanceof LlmError && error.code === "llm_invalid_response"
  );

  const duplicate = run([
    responseCalls([
      ["same", "get_availability"],
      ["same", "get_widgets"],
    ]),
  ]);
  await assert.rejects(duplicate.promise, (error: unknown) =>
    error instanceof LlmError && error.code === "llm_invalid_response"
  );
});

test("injects non-citable budget updates after work rounds", async () => {
  const { model, promise } = run([
    call("c1", "get_availability"),
    submit(),
  ]);
  await promise;
  const budget = model.requests[1].messages.find(
    (message) => message.role === "tool" && message.tool_call_id?.startsWith("_budget_info")
  );
  const parsed = parseYaml(budget?.content as string) as Record<string, unknown>;
  assert.equal(parsed.source, "application_control");
  assert.equal(parsed.remaining_tool_calls, 7);
  assert.equal(parsed.remaining_widget_calls, 8);
});

test("only offers the submission tool once work budgets are exhausted", async () => {
  const { model, promise } = run([
    call("c1", "get_availability"),
    submit(),
  ], {
    config: {
      maxModelAttempts: 3,
      maxToolRounds: 1,
      maxRealToolCalls: 1,
      maxWidgetToolCalls: 0,
    },
  });
  await promise;
  const finalRequest = model.requests[1];
  assert.deepEqual(finalRequest.tools.map((tool) => tool.function.name), ["submit_morning_brief"]);
  assert.ok(!("toolChoice" in finalRequest));
});

test("passes provider reasoning content into the next request", async () => {
  const first = call("c1", "get_availability");
  first.reasoning_content = "provider reasoning";
  const { model, promise } = run([first, submit()]);
  await promise;
  const prior = model.requests[1].messages.find(
    (message) => message.role === "assistant" && message.tool_calls?.some((item) => item.id === "c1")
  );
  assert.equal(prior?.reasoning_content, "provider reasoning");
});
