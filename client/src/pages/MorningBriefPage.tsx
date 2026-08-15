import { FormEvent, useEffect, useRef, useState } from "react";
import {
  generateMorningBrief,
  isMorningBriefWidget,
  MorningBriefApiError,
  queryMorningBriefAssistant,
} from "../api/client";
import { MorningBriefWidget } from "../components/MorningBriefWidget";
import { toDisplayDate } from "../lib/format";
import type {
  MorningBriefAssistantResponse,
  MorningBriefChatMessage,
  MorningBriefContent,
  MorningBriefErrorCode,
  MorningBriefSnapshot,
  MorningBriefWidget as Widget,
} from "../types";

const STORAGE_KEY = "aker.morning-brief.workspace.v1";
const STORAGE_VERSION = 1;
const RECENT_CHAT_LIMIT = 12;

interface PersistedWorkspace {
  version: 1;
  brief: MorningBriefContent | null;
  full_chat: MorningBriefChatMessage[];
  recent_chat: MorningBriefChatMessage[];
  widgets: Widget[];
  snapshot: MorningBriefSnapshot | null;
  revision: number;
}

interface RequestFailure {
  code: MorningBriefErrorCode;
  detail: string;
}

type FailedRequest = { kind: "generate" } | { kind: "query"; question: string; messageId: string };
type RequestStatus = "idle" | "generating" | "asking";

const EMPTY_WORKSPACE: PersistedWorkspace = {
  version: STORAGE_VERSION,
  brief: null,
  full_chat: [],
  recent_chat: [],
  widgets: [],
  snapshot: null,
  revision: 0,
};

const ERROR_COPY: Record<MorningBriefErrorCode, { title: string; message: string }> = {
  NOT_CONFIGURED: {
    title: "Morning Brief is not configured",
    message: "An AI provider must be configured before this workspace can generate a brief.",
  },
  AUTH_REQUIRED: {
    title: "DeepSeek authentication failed",
    message: "The configured API credentials were rejected by DeepSeek.",
  },
  RATE_LIMITED: {
    title: "Request limit reached",
    message: "The provider is rate limiting requests. Wait briefly, then retry.",
  },
  TIMEOUT: {
    title: "The request timed out",
    message: "The provider did not finish within the configured time limit.",
  },
  PROVIDER_UNAVAILABLE: {
    title: "The AI provider is unavailable",
    message: "The provider could not complete the request. Existing workspace content is unchanged.",
  },
  INVALID_RESPONSE: {
    title: "The provider returned an invalid response",
    message: "The response did not match the closed Morning Brief data contract and was not applied.",
  },
  INVESTIGATION_LIMIT: {
    title: "The investigation exceeded its budget",
    message: "The model did not finish within the investigation tool budget. Existing workspace content is unchanged.",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBrief(value: unknown): value is MorningBriefContent {
  return isRecord(value) && typeof value.as_of_date === "string" &&
    typeof value.month_year === "string" && typeof value.model === "string" &&
    isRecord(value.facts) && Array.isArray(value.findings) && Array.isArray(value.semantic_widgets);
}

function isSnapshot(value: unknown): value is MorningBriefSnapshot {
  return isRecord(value) && typeof value.id === "string" && typeof value.as_of_date === "string" &&
    typeof value.captured_at === "string";
}

function isChatMessage(value: unknown): value is MorningBriefChatMessage {
  return isRecord(value) && typeof value.id === "string" &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" && typeof value.created_at === "string";
}

function loadWorkspace(): PersistedWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_WORKSPACE;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== STORAGE_VERSION ||
      (value.brief !== null && !isBrief(value.brief)) ||
      (value.snapshot !== null && !isSnapshot(value.snapshot)) ||
      !Array.isArray(value.widgets) || !value.widgets.every(isMorningBriefWidget) ||
      !Array.isArray(value.full_chat) || !value.full_chat.every(isChatMessage) ||
      !Number.isInteger(value.revision) || Number(value.revision) < 0) return EMPTY_WORKSPACE;
    return {
      version: STORAGE_VERSION,
      brief: value.brief,
      full_chat: value.full_chat,
      recent_chat: value.full_chat.slice(-RECENT_CHAT_LIMIT),
      widgets: value.widgets,
      snapshot: value.snapshot,
      revision: Number(value.revision),
    };
  } catch {
    return EMPTY_WORKSPACE;
  }
}

function makeId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function preservePinnedWidgets(current: Widget[], incoming: Widget[]): Widget[] {
  const currentById = new Map(current.map((widget) => [widget.id, widget]));
  const merged = incoming.map((widget) => {
    const existing = currentById.get(widget.id);
    return existing?.pinned ? existing : { ...widget, pinned: false };
  });
  for (const widget of current) {
    if (widget.pinned && !incoming.some((candidate) => candidate.id === widget.id)) merged.push(widget);
  }
  return merged;
}

function applyAssistantWidgets(current: Widget[], response: MorningBriefAssistantResponse): Widget[] {
  if (response.widget_state) return preservePinnedWidgets(current, response.widget_state);
  const next = [...current];
  for (const operation of response.widget_transaction?.operations ?? []) {
    const index = operation.operation === "delete"
      ? next.findIndex((widget) => widget.id === operation.widget_id)
      : next.findIndex((widget) => widget.id === operation.widget.id);
    if (operation.operation === "delete") {
      if (index >= 0 && !next[index].pinned) next.splice(index, 1);
    } else if (index >= 0) {
      if (!next[index].pinned) next[index] = { ...operation.widget, pinned: false };
    } else {
      next.push({ ...operation.widget, pinned: false });
    }
  }
  return next;
}

function asFailure(error: unknown): RequestFailure {
  if (error instanceof MorningBriefApiError) return { code: error.code, detail: error.message };
  return { code: "PROVIDER_UNAVAILABLE", detail: "The request failed unexpectedly." };
}

export function MorningBriefPage() {
  const [initial] = useState(loadWorkspace);
  const [brief, setBrief] = useState(initial.brief);
  const [chat, setChat] = useState(initial.full_chat);
  const [widgets, setWidgets] = useState(initial.widgets);
  const [snapshot, setSnapshot] = useState(initial.snapshot);
  const [revision, setRevision] = useState(initial.revision);
  const [status, setStatus] = useState<RequestStatus>("idle");
  const [failure, setFailure] = useState<RequestFailure | null>(null);
  const [lastFailed, setLastFailed] = useState<FailedRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const revisionRef = useRef(revision);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const workspace: PersistedWorkspace = {
      version: STORAGE_VERSION,
      brief,
      full_chat: chat,
      recent_chat: chat.slice(-RECENT_CHAT_LIMIT),
      widgets,
      snapshot,
      revision,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    } catch {
      // Storage can be unavailable or full; the in-memory workspace remains usable.
    }
  }, [brief, chat, widgets, snapshot, revision]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  function commitRevision(next: number) {
    revisionRef.current = next;
    setRevision(next);
  }

  function beginRequest(nextStatus: RequestStatus): AbortController {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setStatus(nextStatus);
    setFailure(null);
    setNotice(null);
    return controller;
  }

  function finishRequest(controller: AbortController) {
    if (activeRequest.current === controller) {
      activeRequest.current = null;
      setStatus("idle");
    }
  }

  async function handleGenerate() {
    const controller = beginRequest("generating");
    const baseRevision = revisionRef.current;
    try {
      const response = await generateMorningBrief(
        { base_revision: baseRevision, ...(snapshot ? { snapshot } : {}) },
        controller.signal
      );
      if (revisionRef.current !== baseRevision || response.revision <= baseRevision) {
        setNotice("A newer workspace revision exists, so the generated response was not applied.");
        setLastFailed({ kind: "generate" });
        return;
      }
      setBrief(response.brief);
      setWidgets((current) => preservePinnedWidgets(current, response.widgets));
      setSnapshot(response.snapshot);
      setChat([]);
      commitRevision(response.revision);
      setLastFailed(null);
    } catch (error) {
      if (controller.signal.aborted) {
        setNotice("Generation cancelled. Existing workspace content is unchanged.");
      } else {
        setFailure(asFailure(error));
      }
      setLastFailed({ kind: "generate" });
    } finally {
      finishRequest(controller);
    }
  }

  async function sendQuestion(text: string, existingMessageId?: string) {
    if (!brief || !snapshot || status !== "idle") return;
    const controller = beginRequest("asking");
    const baseRevision = revisionRef.current;
    const message: MorningBriefChatMessage = {
      id: existingMessageId ?? makeId(),
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    const requestChat = existingMessageId ? chat : [...chat, message];
    if (!existingMessageId) setChat(requestChat);
    setQuestion("");

    try {
      const response = await queryMorningBriefAssistant({
        question: text,
        recent_chat: requestChat.slice(-RECENT_CHAT_LIMIT),
        brief,
        widgets,
        snapshot,
        revision: baseRevision,
      }, controller.signal);
      const transactionBase = response.widget_transaction?.base_revision;
      if (revisionRef.current !== baseRevision || response.revision <= baseRevision ||
        (transactionBase !== undefined && transactionBase !== baseRevision)) {
        setNotice("The workspace changed while the assistant was responding, so its answer and widget changes were not applied.");
        setLastFailed({ kind: "query", question: text, messageId: message.id });
        return;
      }
      setWidgets((current) => applyAssistantWidgets(current, response));
      setSnapshot(response.snapshot);
      setBrief((current) => current ? { ...current, semantic_widgets: response.semantic_widgets } : current);
      setChat((current) => [...current, {
        id: makeId(),
        role: "assistant",
        content: response.answer,
        created_at: new Date().toISOString(),
      }]);
      commitRevision(response.revision);
      setLastFailed(null);
    } catch (error) {
      if (controller.signal.aborted) setNotice("Assistant request cancelled.");
      else setFailure(asFailure(error));
      setLastFailed({ kind: "query", question: text, messageId: message.id });
    } finally {
      finishRequest(controller);
    }
  }

  function handleQuestion(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (text) void sendQuestion(text);
  }

  function retryLastRequest() {
    if (!lastFailed || status !== "idle") return;
    if (lastFailed.kind === "generate") void handleGenerate();
    else void sendQuestion(lastFailed.question, lastFailed.messageId);
  }

  function mutateWidget(id: string, action: "pin" | "delete") {
    const nextRevision = revisionRef.current + 1;
    setWidgets((current) => action === "delete"
      ? current.filter((widget) => widget.id !== id)
      : current.map((widget) => widget.id === id ? { ...widget, pinned: !widget.pinned } : widget));
    if (action === "delete") {
      setBrief((current) => current
        ? {
            ...current,
            semantic_widgets: current.semantic_widgets.filter((widget) => widget.id !== id),
          }
        : current);
    }
    commitRevision(nextRevision);
    setNotice(null);
  }

  const busy = status !== "idle";
  const errorCopy = failure ? ERROR_COPY[failure.code] : null;

  return (
    <div className="morning-brief-page">
      <div className="page-header">
        <h1>Morning Brief</h1>
        <div className="brief-heading-actions">
          {brief && (
            <div className="as-of">
              <span className="as-of-label">Data as of</span>
              <span className="as-of-value">{toDisplayDate(brief.as_of_date)}</span>
            </div>
          )}
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void handleGenerate()}>
            {status === "generating" ? "Generating…" : brief ? "Regenerate brief" : "Generate brief"}
          </button>
          {busy && <button className="btn" type="button" onClick={() => activeRequest.current?.abort()}>Cancel</button>}
        </div>
      </div>

      {failure && errorCopy && (
        <section className="brief-error" role="alert">
          <div><strong>{errorCopy.title}</strong><p>{errorCopy.message}</p><small>{failure.detail}</small></div>
          <button className="btn" type="button" disabled={busy} onClick={retryLastRequest}>Retry</button>
        </section>
      )}
      {notice && (
        <div className="brief-notice" role="status">
          <span>{notice}</span>
          {lastFailed && <button className="btn" type="button" disabled={busy} onClick={retryLastRequest}>Retry</button>}
        </div>
      )}

      <div className="morning-workspace">
        <main className="widget-board" aria-label="Morning Brief widget board">
          <div className="workspace-section-label">
            <span>Decision board</span><span>{widgets.length} {widgets.length === 1 ? "widget" : "widgets"}</span>
          </div>
          {status === "generating" && !brief && (
            <div className="brief-loading"><span className="loading-line" /><strong>Building your brief</strong><p>Reviewing the current portfolio snapshot and selecting useful views.</p></div>
          )}
          {!brief && status !== "generating" && (
            <div className="brief-empty">
              <h2>Start with today’s snapshot</h2>
              <p>Nothing is generated automatically. Select Generate brief when you are ready to contact the provider.</p>
              <button className="btn btn-primary" type="button" onClick={() => void handleGenerate()}>Generate brief</button>
            </div>
          )}
          {brief && widgets.length === 0 && <div className="brief-empty compact"><h2>No widgets in this revision</h2><p>Ask the assistant to add a portfolio view, or regenerate the brief.</p></div>}
          {widgets.map((widget) => (
            <MorningBriefWidget key={widget.id} widget={widget} onTogglePin={(id) => mutateWidget(id, "pin")} onDelete={(id) => mutateWidget(id, "delete")} />
          ))}
        </main>

        <aside className="brief-rail">
          <section className="brief-document">
            <div className="workspace-section-label"><span>Brief</span>{brief && <span>As of {toDisplayDate(brief.as_of_date)}</span>}</div>
            {brief ? (
              <>
                <h2>Portfolio Morning Brief</h2>
                <p className="brief-summary">{brief.findings.length} grounded {brief.findings.length === 1 ? "finding" : "findings"} from {brief.model}. Scope: {brief.facts.scope.candidate_property_codes.length} candidate {brief.facts.scope.candidate_property_codes.length === 1 ? "property" : "properties"}.</p>
                <ol className="finding-list">
                  {brief.findings.map((finding) => (
                    <li className={`finding finding-${finding.priority}`} key={finding.id}>
                      <span className="finding-marker" />
                      <div>
                        <strong>{finding.title}</strong>
                        <p>{finding.summary}</p>
                        {finding.recommended_action && <p className="finding-action"><b>Action:</b> {finding.recommended_action}</p>}
                        <small>{finding.priority} priority · {finding.property_codes.join(", ") || "portfolio"} · {finding.evidence.length} {finding.evidence.length === 1 ? "source" : "sources"}</small>
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            ) : <p className="rail-placeholder">Your generated summary and findings will appear here.</p>}
          </section>

          <section className="brief-chat">
            <div className="chat-heading"><div><span className="workspace-section-label"><span>Ask the brief</span></span><p>Answers may update unpinned widgets.</p></div><span className="chat-status">{brief ? "Ready" : "Waiting for brief"}</span></div>
            <div className="chat-thread" aria-live="polite">
              {chat.length === 0 && <p className="chat-empty">{brief ? "Ask a follow-up about priorities, availability, expirations, rent gaps, or data quality." : "Generate a successful brief to enable questions."}</p>}
              {chat.map((message) => <div className={`chat-message chat-${message.role}`} key={message.id}><span>{message.role === "user" ? "You" : "Assistant"}</span><p>{message.content}</p></div>)}
              {status === "asking" && <div className="chat-message chat-assistant chat-thinking"><span>Assistant</span><p>Reviewing the snapshot…</p></div>}
            </div>
            <form className="chat-composer" onSubmit={handleQuestion}>
              <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={brief ? "Ask a follow-up question…" : "Generate a brief first"} disabled={!brief || busy} rows={3} />
              <div><small>{chat.length} messages saved locally</small><button className="btn btn-primary" type="submit" disabled={!brief || busy || !question.trim()}>Ask</button></div>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
}
