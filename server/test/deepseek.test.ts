import { test } from "node:test";
import assert from "node:assert/strict";
import { DeepSeekChatModel } from "../src/deepseek.js";
import { LlmError, type ModelRequest } from "../src/assistant-types.js";

const request: ModelRequest = {
  messages: [{ role: "user", content: "test" }],
  tools: [],
  jsonMode: true,
};

function errorCode(code: string) {
  return (error: unknown) => error instanceof LlmError && error.code === code;
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
