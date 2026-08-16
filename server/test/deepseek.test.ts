import { test } from "node:test";
import assert from "node:assert/strict";
import { DeepSeekChatModel } from "../src/deepseek.js";
import { LlmError, type ModelRequest, type ModelTool } from "../src/assistant-types.js";
import type { LlmTrace } from "../src/llm-trace.js";

const request: ModelRequest = {
  messages: [{ role: "user", content: "test" }],
  tools: [],
};

const sampleTool: ModelTool = {
  type: "function",
  function: { name: "get_availability", description: "read availability", parameters: {} },
};

function errorCode(code: string) {
  return (error: unknown) => error instanceof LlmError && error.code === code;
}

function okResponse() {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

test("DeepSeek reports missing configuration without making a request", async () => {
  const model = new DeepSeekChatModel({
    apiKey: "",
    fetchImpl: async () => {
      throw new Error("fetch should not run");
    },
  });
  await assert.rejects(model.complete(request), errorCode("llm_not_configured"));
});

test("DeepSeek maps authentication and rate-limit responses", async () => {
  const auth = new DeepSeekChatModel({
    apiKey: "test",
    fetchImpl: async () => new Response(null, { status: 401 }),
  });
  await assert.rejects(auth.complete(request), errorCode("llm_auth_failed"));

  const rateLimit = new DeepSeekChatModel({
    apiKey: "test",
    fetchImpl: async () => new Response(null, { status: 429 }),
  });
  await assert.rejects(rateLimit.complete(request), errorCode("llm_rate_limited"));
});

test("DeepSeek rejects malformed provider payloads", async () => {
  const model = new DeepSeekChatModel({
    apiKey: "test",
    fetchImpl: async () => new Response("not-json", { status: 200 }),
  });
  await assert.rejects(model.complete(request), errorCode("llm_invalid_response"));
});

test("DeepSeek aborts requests at the configured timeout", async () => {
  const model = new DeepSeekChatModel({
    apiKey: "test",
    timeoutMs: 5,
    fetchImpl: (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  });
  await assert.rejects(model.complete(request), errorCode("llm_timeout"));
});

test("DeepSeek omits tools and tool_choice from the body when no tools are provided", async () => {
  let body: Record<string, unknown> = {};
  const model = new DeepSeekChatModel({
    apiKey: "test",
    fetchImpl: async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return okResponse();
    },
  });
  await model.complete(request);
  assert.ok(!("tools" in body));
  assert.ok(!("tool_choice" in body));
});

test("DeepSeek includes tools and tool_choice auto when tools are provided", async () => {
  let body: Record<string, unknown> = {};
  const model = new DeepSeekChatModel({
    apiKey: "test",
    fetchImpl: async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return okResponse();
    },
  });
  await model.complete({ ...request, tools: [sampleTool] });
  assert.deepEqual(body.tools, [sampleTool]);
  assert.equal(body.tool_choice, "auto");
});

test("DeepSeek forwards required and named tool choices", async () => {
  const bodies: Record<string, unknown>[] = [];
  const model = new DeepSeekChatModel({
    apiKey: "test",
    fetchImpl: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return okResponse();
    },
  });
  await model.complete({ ...request, tools: [sampleTool], toolChoice: "required" });
  await model.complete({
    ...request,
    tools: [sampleTool],
    toolChoice: { type: "function", function: { name: "get_availability" } },
  });
  assert.equal(bodies[0].tool_choice, "required");
  assert.deepEqual(bodies[1].tool_choice, {
    type: "function",
    function: { name: "get_availability" },
  });
});

test("DeepSeek rejects a named choice for an unavailable tool", async () => {
  const model = new DeepSeekChatModel({
    apiKey: "test",
    fetchImpl: async () => {
      throw new Error("fetch should not run");
    },
  });
  await assert.rejects(
    model.complete({
      ...request,
      tools: [sampleTool],
      toolChoice: { type: "function", function: { name: "missing" } },
    }),
    errorCode("llm_invalid_response")
  );
});

test("DeepSeek preserves provider tool calls with null content", async () => {
  const model = new DeepSeekChatModel({
    apiKey: "test",
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "submit",
            type: "function",
            function: { name: "submit_morning_brief", arguments: '{"findings":[]}' },
          }],
        },
        finish_reason: "tool_calls",
      }],
    }), { status: 200 }),
  });
  const response = await model.complete(request);
  assert.equal(response.content, null);
  assert.equal(response.tool_calls?.[0]?.function.name, "submit_morning_brief");
});

test("DeepSeek preserves finish_reason from the provider payload", async () => {
  const model = new DeepSeekChatModel({
    apiKey: "test",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [{
            message: { content: "ok", reasoning_content: "provider reasoning" },
            finish_reason: "tool_calls",
          }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
  });
  const message = await model.complete(request);
  assert.equal(message.finish_reason, "tool_calls");
  assert.equal(message.reasoning_content, "provider reasoning");
});

test("DeepSeek traces the exact provider request and response", async () => {
  const traces: LlmTrace[] = [];
  const providerBody = {
    id: "response-1",
    choices: [{
      message: { content: null, reasoning_content: "reason", tool_calls: [] },
      finish_reason: "stop",
    }],
    usage: { total_tokens: 25 },
  };
  const model = new DeepSeekChatModel({
    apiKey: "test",
    model: "trace-model",
    traceWriter: { save: async (trace) => { traces.push(trace); } },
    fetchImpl: async () => new Response(JSON.stringify(providerBody), { status: 200 }),
  });

  await model.complete({ ...request, tools: [sampleTool] });

  assert.equal(traces.length, 1);
  assert.equal(traces[0].outcome, "success");
  assert.deepEqual(traces[0].request, {
    model: "trace-model",
    messages: request.messages,
    temperature: 0.1,
    tools: [sampleTool],
    tool_choice: "auto",
  });
  assert.deepEqual(traces[0].response, { httpStatus: 200, body: providerBody });
  assert.equal(traces[0].error, null);
});

test("DeepSeek traces HTTP errors, invalid JSON, and timeouts", async () => {
  const traces: LlmTrace[] = [];
  const traceWriter = { save: async (trace: LlmTrace) => { traces.push(trace); } };
  const auth = new DeepSeekChatModel({
    apiKey: "test",
    traceWriter,
    fetchImpl: async () => new Response(
      JSON.stringify({ error: { message: "bad key", type: "auth" } }),
      { status: 401 }
    ),
  });
  const invalid = new DeepSeekChatModel({
    apiKey: "test",
    traceWriter,
    fetchImpl: async () => new Response("not-json", { status: 200 }),
  });
  const timeout = new DeepSeekChatModel({
    apiKey: "test",
    timeoutMs: 5,
    traceWriter,
    fetchImpl: (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  });

  await assert.rejects(auth.complete(request), errorCode("llm_auth_failed"));
  await assert.rejects(invalid.complete(request), errorCode("llm_invalid_response"));
  await assert.rejects(timeout.complete(request), errorCode("llm_timeout"));

  assert.equal(traces[0].outcome, "http_error");
  assert.deepEqual(traces[0].response, {
    httpStatus: 401,
    body: { error: { message: "bad key", type: "auth" } },
  });
  assert.equal(traces[1].outcome, "invalid_json");
  assert.deepEqual(traces[1].response, { httpStatus: 200, rawText: "not-json" });
  assert.equal(traces[2].outcome, "timeout");
  assert.equal(traces[2].response, null);
});

test("trace write failures do not change successful model responses", async () => {
  const model = new DeepSeekChatModel({
    apiKey: "test",
    traceWriter: { save: async () => { throw new Error("disk full"); } },
    fetchImpl: async () => okResponse(),
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.equal((await model.complete(request)).content, "ok");
  } finally {
    console.error = originalConsoleError;
  }
});
