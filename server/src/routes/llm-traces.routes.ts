import { Router } from "express";
import type {
  LlmTrace,
  LlmTracePage,
  LlmTraceReader,
  StoredLlmTrace,
} from "../llm-trace.js";

const PAGE_SIZE = 50;

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  return escapeHtml(serialized === undefined ? "undefined" : serialized);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function document(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body>
${body}
</body>
</html>`;
}

function pageNumber(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function renderPagination(page: number, total: number): string {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const previous = page > 1
    ? `<a href="?page=${page - 1}">Previous</a>`
    : "Previous";
  const next = page < pageCount
    ? `<a href="?page=${page + 1}">Next</a>`
    : "Next";
  return `<nav>${previous} | Page ${page} of ${pageCount} | ${next}</nav>`;
}

export function renderTraceList(data: LlmTracePage): string {
  const rows = data.entries.map((entry) => `<tr>
  <td><a href="/api/debug/llm-traces/${encodeURIComponent(entry.traceId)}">${escapeHtml(entry.traceId)}</a></td>
  <td>${escapeHtml(entry.startedAt ?? "unknown")}</td>
  <td>${escapeHtml(entry.model ?? "unknown")}</td>
  <td>${escapeHtml(entry.corrupt ? "corrupt" : entry.outcome ?? "unknown")}</td>
  <td>${escapeHtml(entry.httpStatus ?? "")}</td>
  <td>${escapeHtml(entry.durationMs === null ? "" : `${entry.durationMs} ms`)}</td>
</tr>`).join("\n");
  const pagination = renderPagination(data.page, data.total);
  return document("LLM traces", `<main>
<h1>LLM traces</h1>
<p>${data.total} saved exchange${data.total === 1 ? "" : "s"}. Newest first.</p>
${pagination}
<table>
<thead><tr><th>Trace ID</th><th>Started</th><th>Model</th><th>Outcome</th><th>HTTP</th><th>Duration</th></tr></thead>
<tbody>${rows}</tbody>
</table>
${pagination}
</main>`);
}

function renderMessages(request: Record<string, unknown> | null): string {
  if (!Array.isArray(request?.messages)) return "<p>No messages.</p>";
  return request.messages.map((value, index) => {
    const message = record(value);
    if (!message) return `<h3>Message ${index + 1}</h3><pre>${json(value)}</pre>`;
    const role = typeof message.role === "string" ? message.role : "unknown";
    const details = { ...message };
    delete details.role;
    delete details.content;
    return `<article>
<h3>Message ${index + 1}: ${escapeHtml(role)}</h3>
<pre>${escapeHtml(message.content === null ? "null" : message.content ?? "")}</pre>
${Object.keys(details).length > 0 ? `<details><summary>Message fields</summary><pre>${json(details)}</pre></details>` : ""}
</article>`;
  }).join("\n");
}

function renderResponse(trace: LlmTrace): string {
  if (!trace.response) return "<p>No provider response was received.</p>";
  if (trace.response.body === undefined) {
    return `<p>HTTP ${escapeHtml(trace.response.httpStatus)}</p>
<h3>Raw response text</h3>
<pre>${escapeHtml(trace.response.rawText ?? "")}</pre>`;
  }

  const body = record(trace.response.body);
  const choices = Array.isArray(body?.choices) ? body.choices : [];
  const firstChoice = record(choices[0]);
  const message = record(firstChoice?.message);
  const readable = message
    ? `<h3>Assistant content</h3>
<pre>${escapeHtml(message.content === null ? "null" : message.content ?? "")}</pre>
${message.reasoning_content === undefined ? "" : `<h3>Reasoning content</h3><pre>${escapeHtml(message.reasoning_content)}</pre>`}
${message.tool_calls === undefined ? "" : `<h3>Tool calls</h3><pre>${json(message.tool_calls)}</pre>`}
${firstChoice?.finish_reason === undefined ? "" : `<p>Finish reason: ${escapeHtml(firstChoice.finish_reason)}</p>`}
${body?.usage === undefined ? "" : `<h3>Usage</h3><pre>${json(body.usage)}</pre>`}`
    : "<p>No readable assistant message found.</p>";
  return `<p>HTTP ${escapeHtml(trace.response.httpStatus)}</p>${readable}`;
}

export function renderTraceDetail(stored: StoredLlmTrace, traceId: string): string {
  if (!stored.trace) {
    return document("Corrupt LLM trace", `<main>
<p><a href="/api/debug/llm-traces">Back to traces</a></p>
<h1>Corrupt LLM trace</h1>
<p>${escapeHtml(stored.parseError ?? "Invalid JSON")}</p>
<pre>${escapeHtml(stored.raw)}</pre>
</main>`);
  }

  const trace = stored.trace;
  const request = record(trace.request);
  return document(`LLM trace ${traceId}`, `<main>
<p><a href="/api/debug/llm-traces">Back to traces</a></p>
<h1>LLM trace</h1>
<dl>
<dt>Trace ID</dt><dd>${escapeHtml(trace.traceId)}</dd>
<dt>Provider</dt><dd>${escapeHtml(trace.provider)}</dd>
<dt>Endpoint</dt><dd>${escapeHtml(trace.endpoint)}</dd>
<dt>Started</dt><dd>${escapeHtml(trace.startedAt)}</dd>
<dt>Completed</dt><dd>${escapeHtml(trace.completedAt)}</dd>
<dt>Duration</dt><dd>${escapeHtml(trace.durationMs)} ms</dd>
<dt>Outcome</dt><dd>${escapeHtml(trace.outcome)}</dd>
</dl>
${trace.error ? `<h2>Error</h2><pre>${json(trace.error)}</pre>` : ""}
<h2>Request messages</h2>
${renderMessages(request)}
${request?.tools === undefined ? "" : `<h2>Available tools</h2><pre>${json(request.tools)}</pre>`}
<h2>Response</h2>
${renderResponse(trace)}
<h2>Raw exchange JSON</h2>
<details open><summary>Complete trace</summary><pre>${json(trace)}</pre></details>
</main>`);
}

export function llmTracesRouter(store: LlmTraceReader): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const page = pageNumber(req.query.page);
      res.type("html").send(renderTraceList(await store.list(page, PAGE_SIZE)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:traceId", async (req, res, next) => {
    try {
      const stored = await store.read(req.params.traceId);
      if (!stored) {
        res.status(404).type("html").send(document("Trace not found", `<main>
<p><a href="/api/debug/llm-traces">Back to traces</a></p>
<h1>Trace not found</h1>
</main>`));
        return;
      }
      res.type("html").send(renderTraceDetail(stored, req.params.traceId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
