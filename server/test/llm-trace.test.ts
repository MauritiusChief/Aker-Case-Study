import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import {
  FileLlmTraceStore,
  type LlmTrace,
} from "../src/llm-trace.js";
import {
  llmTracesRouter,
  renderTraceDetail,
  renderTraceList,
} from "../src/routes/llm-traces.routes.js";

function sampleTrace(overrides: Partial<LlmTrace> = {}): LlmTrace {
  return {
    schemaVersion: 1,
    traceId: "d4d9fd1a-c337-43e6-a711-ebc34c6f6001",
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/chat/completions",
    startedAt: "2026-08-15T12:00:00.000Z",
    completedAt: "2026-08-15T12:00:01.000Z",
    durationMs: 1_000,
    outcome: "success",
    request: { model: "test-model", messages: [{ role: "user", content: "hello" }] },
    response: {
      httpStatus: 200,
      body: { choices: [{ message: { content: "world" }, finish_reason: "stop" }] },
    },
    error: null,
    ...overrides,
  };
}

test("file trace store atomically saves, lists, and reads exchanges", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aker-llm-traces-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new FileLlmTraceStore(directory);
  const trace = sampleTrace();

  await store.save(trace);

  const files = await readdir(directory);
  assert.equal(files.length, 1);
  assert.match(files[0], new RegExp(`${trace.traceId}\\.json$`));
  assert.ok(!files[0].endsWith(".tmp"));

  const page = await store.list(1, 50);
  assert.equal(page.total, 1);
  assert.deepEqual(page.entries[0], {
    traceId: trace.traceId,
    startedAt: trace.startedAt,
    model: "test-model",
    outcome: "success",
    httpStatus: 200,
    durationMs: 1_000,
    corrupt: false,
  });

  const stored = await store.read(trace.traceId);
  assert.deepEqual(stored?.trace, trace);
  assert.equal(stored?.parseError, null);
});

test("file trace store isolates corrupt files and rejects invalid trace ids", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aker-llm-traces-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const traceId = "4bfbe534-3fcf-46ca-b27f-65f7b674b934";
  await writeFile(
    path.join(directory, `2026-08-15T12-00-00-000Z_${traceId}.json`),
    "{not-json",
    "utf8"
  );
  const store = new FileLlmTraceStore(directory);

  const page = await store.list(1, 50);
  assert.equal(page.entries[0].corrupt, true);
  const stored = await store.read(traceId);
  assert.equal(stored?.trace, null);
  assert.ok(stored?.parseError);
  assert.equal(await store.read("../aker.db"), null);
});

test("trace viewer renders readable fields and escapes recorded content", () => {
  const dangerous = "</pre><script>alert('trace')</script>";
  const trace = sampleTrace({
    request: {
      model: "test-model",
      messages: [{ role: "user", content: dangerous }],
      tools: [{ type: "function", function: { name: "lookup" } }],
    },
    response: {
      httpStatus: 200,
      body: {
        choices: [{
          message: { content: "answer", reasoning_content: dangerous },
          finish_reason: "stop",
        }],
        usage: { total_tokens: 42 },
      },
    },
  });

  const detail = renderTraceDetail(
    { trace, raw: JSON.stringify(trace), parseError: null },
    trace.traceId
  );
  assert.match(detail, /Request messages/);
  assert.match(detail, /Reasoning content/);
  assert.match(detail, /total_tokens/);
  assert.ok(!detail.includes("<script>"));
  assert.match(detail, /&lt;script&gt;/);

  const list = renderTraceList({
    entries: [{
      traceId: trace.traceId,
      startedAt: trace.startedAt,
      model: "test-model",
      outcome: "success",
      httpStatus: 200,
      durationMs: 1_000,
      corrupt: false,
    }],
    page: 1,
    pageSize: 50,
    total: 1,
  });
  assert.match(list, new RegExp(`/api/debug/llm-traces/${trace.traceId}`));
});

test("trace viewer serves list and detail pages over HTTP", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aker-llm-traces-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new FileLlmTraceStore(directory);
  const trace = sampleTrace();
  await store.save(trace);

  const app = express();
  app.use("/api/debug/llm-traces", llmTracesRouter(store));
  const server = app.listen(0);
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const { port } = server.address() as AddressInfo;

  const listResponse = await fetch(`http://127.0.0.1:${port}/api/debug/llm-traces`);
  assert.equal(listResponse.status, 200);
  assert.match(listResponse.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(await listResponse.text(), /LLM traces/);

  const detailResponse = await fetch(
    `http://127.0.0.1:${port}/api/debug/llm-traces/${trace.traceId}`
  );
  assert.equal(detailResponse.status, 200);
  assert.match(await detailResponse.text(), /Raw exchange JSON/);

  const missingResponse = await fetch(
    `http://127.0.0.1:${port}/api/debug/llm-traces/not-a-trace-id`
  );
  assert.equal(missingResponse.status, 404);
});
