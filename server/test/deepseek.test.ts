import { test } from "node:test";
import assert from "node:assert/strict";
import { DeepSeekChatModel } from "../src/deepseek.js";
import { LlmError, type ModelRequest, type ModelTool } from "../src/assistant-types.js";

const request: ModelRequest = {
  messages: [{ role: "user", content: "test" }],
  tools: [],
  jsonMode: true,
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
