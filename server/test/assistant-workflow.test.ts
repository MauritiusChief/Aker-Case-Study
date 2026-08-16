import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateMorningBrief,
  answerAssistantQuery,
} from "../src/assistant-workflow.js";
import { LlmError, type BriefFacts, type ChatModel, type ModelMessage, type ModelRequest } from "../src/assistant-types.js";

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
  limitations: ["The source is a single portfolio snapshot; historical change is unavailable."],
};

class FakeModel implements ChatModel {
  readonly name = "fake-model";
  private index = 0;
  constructor(private readonly responses: ModelMessage[]) {}
  async complete(_request: ModelRequest): Promise<ModelMessage> {
    const response = this.responses[this.index++];
    if (!response) throw new Error("No fake response");
    return response;
  }
}

function submit(name: "submit_morning_brief" | "submit_assistant_answer", value: unknown): ModelMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{
      id: `call-${name}`,
      type: "function",
      function: { name, arguments: JSON.stringify(value) },
    }],
  };
}

test("morning workflow executes bounded tools and validates grounded output", async () => {
  const model = new FakeModel([
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "get_availability", arguments: "{}" },
        },
      ],
    },
    submit("submit_morning_brief", {
        findings: [
          {
            id: "availability",
            title: "Availability requires attention",
            summary: "Two units are available.",
            priority: "high",
            property_codes: ["P1"],
            evidence: [{ source_id: "tool_1", path: "/portfolio/available_units" }],
          },
        ],
      }),
  ]);
  const result = await generateMorningBrief(model, facts, () => ({
    portfolio: { available_units: 2 },
  }));
  assert.equal(result.findings.length, 1);
  assert.equal(result.investigation.tool_calls, 1);
  assert.equal(result.model, "fake-model");
});

test("workflow rejects citations that are not grounded in returned sources", async () => {
  const model = new FakeModel([
    submit("submit_morning_brief", {
        findings: [
          {
            id: "bad",
            title: "Bad citation",
            summary: "Unsupported.",
            priority: "high",
            property_codes: [],
            evidence: [{ source_id: "brief_facts", path: "/portfolio/not_real" }],
          },
        ],
      }),
  ]);
  await assert.rejects(
    generateMorningBrief(model, facts, () => ({})),
    (error: unknown) => error instanceof LlmError && error.code === "llm_invalid_response"
  );
});

test("morning workflow requires investigation before publishing findings", async () => {
  const model = new FakeModel([
    submit("submit_morning_brief", {
        findings: [
          {
            id: "unverified",
            title: "Unverified finding",
            summary: "This was not investigated.",
            priority: "medium",
            property_codes: [],
            evidence: [{ source_id: "brief_facts", path: "/portfolio/available_units" }],
          },
        ],
      }),
  ]);
  await assert.rejects(
    generateMorningBrief(model, facts, () => ({})),
    (error: unknown) => error instanceof LlmError && error.code === "llm_invalid_response"
  );
});

test("Q&A uses prior brief context and returns validated widget changes", async () => {
  const model = new FakeModel([
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "create-widget",
          type: "function",
          function: {
            name: "create_widget",
            arguments: JSON.stringify({
              widget: {
                id: "availability-p1",
                type: "availability",
                title: "P1 availability",
                scope: { level: "property", property_codes: ["P1"] },
              },
            }),
          },
        },
        {
          id: "submit-answer",
          type: "function",
          function: {
            name: "submit_assistant_answer",
            arguments: JSON.stringify({
        answer: "The snapshot has two available units.",
        citations: [{ source_id: "brief_facts", path: "/portfolio/available_units" }],
            }),
          },
        },
      ],
    },
  ]);
  const result = await answerAssistantQuery(
    model,
    facts,
    () => ({}),
    { findings: [], widgets: [] },
    [{ role: "user", content: "What needs attention?" }],
    "How many units are available?"
  );
  assert.equal(result.answer, "The snapshot has two available units.");
  assert.equal(result.widget_operations[0]?.op, "upsert");
  assert.equal(result.widgets[0]?.id, "availability-p1");
});

test("four consecutive investigation rounds still produce a validated brief", async () => {
  const toolRound = (id: string): ModelMessage => ({
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id,
        type: "function",
        function: { name: "get_availability", arguments: "{}" },
      },
    ],
  });
  const model = new FakeModel([
    toolRound("c1"),
    toolRound("c2"),
    toolRound("c3"),
    toolRound("c4"),
    submit("submit_morning_brief", {
        findings: [
          {
            id: "availability",
            title: "Availability requires attention",
            summary: "Two units are available.",
            priority: "high",
            property_codes: ["P1"],
            evidence: [{ source_id: "tool_4", path: "/portfolio/available_units" }],
          },
        ],
      }),
  ]);
  const result = await generateMorningBrief(model, facts, () => ({
    portfolio: { available_units: 2 },
  }));
  assert.equal(result.findings.length, 1);
  assert.equal(result.investigation.tool_calls, 4);
});

test("citations to the injected _budget_info source are rejected", async () => {
  const model = new FakeModel([
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: { name: "get_availability", arguments: "{}" },
        },
      ],
    },
    submit("submit_morning_brief", {
        findings: [
          {
            id: "bad-budget",
            title: "Budget citation",
            summary: "Unsupported.",
            priority: "high",
            property_codes: ["P1"],
            evidence: [{ source_id: "_budget_info", path: "/remaining_tool_calls" }],
          },
        ],
      }),
  ]);
  await assert.rejects(
    generateMorningBrief(model, facts, () => ({ portfolio: { available_units: 2 } })),
    (error: unknown) => error instanceof LlmError && error.code === "llm_invalid_response"
  );
});
