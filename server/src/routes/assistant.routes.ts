import { Router, type Response } from "express";
import type { AppDatabase } from "../db/index.js";
import { AS_OF_DATE, BOOKING_STALE_DAYS, DEFAULT_MONTH_YEAR } from "../config.js";
import type {
  ChatModel,
  LlmErrorCode,
  SemanticWidget,
  WidgetType,
} from "../assistant-types.js";
import { LlmError } from "../assistant-types.js";
import { buildBriefFacts } from "../brief-facts.js";
import { createToolExecutor } from "../assistant-tools.js";
import {
  answerAssistantQuery,
  generateMorningBrief,
  type ConversationMessage,
  type PriorBrief,
} from "../assistant-workflow.js";

const options = {
  asOfDate: AS_OF_DATE,
  staleDays: BOOKING_STALE_DAYS,
  monthYear: DEFAULT_MONTH_YEAR,
};

class RequestError extends Error {}

function sendError(res: Response, error: unknown): void {
  if (error instanceof RequestError) {
    res.status(400).json({ error: { code: "invalid_request", message: error.message } });
    return;
  }
  if (error instanceof LlmError) {
    const statuses: Record<LlmErrorCode, number> = {
      llm_not_configured: 503,
      llm_auth_failed: 502,
      llm_rate_limited: 429,
      llm_timeout: 504,
      llm_provider_error: 502,
      llm_invalid_response: 502,
    };
    res.status(statuses[error.code]).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }
  throw error;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    throw new RequestError(`${label} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function stringList(value: unknown, label: string, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new RequestError(`${label} must be an array with at most ${maxItems} items`);
  }
  return value.map((item, index) => boundedString(item, `${label}[${index}]`, 100));
}

function parseBrief(value: unknown): PriorBrief {
  const input = record(value, "brief");
  const widgets = input.widgets ?? input.semantic_widgets;
  if (!Array.isArray(input.findings) || input.findings.length > 5) {
    throw new RequestError("brief.findings must contain 0 to 5 items");
  }
  if (!Array.isArray(widgets) || widgets.length > 6) {
    throw new RequestError("brief widgets must contain 0 to 6 items");
  }
  return {
    findings: input.findings.map((value, index) => {
      const finding = record(value, `brief.findings[${index}]`);
      return {
        title: boundedString(finding.title, `brief.findings[${index}].title`, 160),
        summary: boundedString(finding.summary, `brief.findings[${index}].summary`, 800),
        priority: boundedString(finding.priority, `brief.findings[${index}].priority`, 20),
        property_codes: stringList(
          finding.property_codes,
          `brief.findings[${index}].property_codes`,
          6
        ),
      };
    }),
    widgets: widgets.map((value, index) => {
      const widget = record(value, `brief.widgets[${index}]`);
      const scope = record(widget.scope, `brief.widgets[${index}].scope`);
      const type = boundedString(widget.type, `brief.widgets[${index}].type`, 50);
      const widgetTypes: WidgetType[] = [
        "kpi",
        "property_comparison",
        "availability",
        "lease_expirations",
        "rent_gap",
        "data_quality",
      ];
      if (!widgetTypes.includes(type as WidgetType)) {
        throw new RequestError(`brief.widgets[${index}].type is invalid`);
      }
      const level = boundedString(scope.level, `brief.widgets[${index}].scope.level`, 20);
      if (!(["portfolio", "property", "comparison"] as string[]).includes(level)) {
        throw new RequestError(`brief.widgets[${index}].scope.level is invalid`);
      }
      const sourceIds = stringList(
        widget.source_ids,
        `brief.widgets[${index}].source_ids`,
        8
      );
      const rawFilters = widget.filters === undefined
        ? undefined
        : record(widget.filters, `brief.widgets[${index}].filters`);
      const filters = rawFilters?.lease_bucket === undefined
        ? undefined
        : {
            lease_bucket: boundedString(
              rawFilters.lease_bucket,
              `brief.widgets[${index}].filters.lease_bucket`,
              30
            ),
          };
      return {
        id: boundedString(widget.id, `brief.widgets[${index}].id`, 80),
        type: type as WidgetType,
        title: boundedString(widget.title, `brief.widgets[${index}].title`, 160),
        scope: {
          level: level as SemanticWidget["scope"]["level"],
          property_codes: stringList(
            scope.property_codes,
            `brief.widgets[${index}].scope.property_codes`,
            6
          ),
        },
        source_ids: sourceIds,
        ...(filters ? { filters } : {}),
      } satisfies SemanticWidget;
    }),
  };
}

function parseConversation(value: unknown): ConversationMessage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 12) {
    throw new RequestError("conversation must contain at most 12 messages");
  }
  return value.map((item, index) => {
    const message = record(item, `conversation[${index}]`);
    if (message.role !== "user" && message.role !== "assistant") {
      throw new RequestError(`conversation[${index}].role is invalid`);
    }
    return {
      role: message.role,
      content: boundedString(message.content, `conversation[${index}].content`, 4_000),
    };
  });
}

function context(db: AppDatabase, scope: "candidate" | "portfolio") {
  const facts = buildBriefFacts(db, options);
  return { facts, executeTool: createToolExecutor(db, options, facts, scope) };
}

export function morningBriefRouter(db: AppDatabase, model: ChatModel): Router {
  const router = Router();
  router.post("/generate", async (_req, res, next) => {
    try {
      const { facts, executeTool } = context(db, "candidate");
      res.json(await generateMorningBrief(model, facts, executeTool));
    } catch (error) {
      try {
        sendError(res, error);
      } catch (unhandled) {
        next(unhandled);
      }
    }
  });
  return router;
}

export function assistantRouter(db: AppDatabase, model: ChatModel): Router {
  const router = Router();
  router.post("/query", async (req, res, next) => {
    try {
      const body = record(req.body, "body");
      const brief = parseBrief(body.brief);
      const conversation = parseConversation(body.conversation ?? body.recent_chat);
      const question = boundedString(body.question, "question", 2_000);
      const { facts, executeTool } = context(db, "portfolio");
      res.json(
        await answerAssistantQuery(
          model,
          facts,
          executeTool,
          brief,
          conversation,
          question
        )
      );
    } catch (error) {
      try {
        sendError(res, error);
      } catch (unhandled) {
        next(unhandled);
      }
    }
  });
  return router;
}
