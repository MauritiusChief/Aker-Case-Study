import express, { type Express } from "express";
import type { AppDatabase } from "./db/index.js";
import { propertiesRouter } from "./routes/properties.routes.js";
import { unitsRouter } from "./routes/units.routes.js";
import { residentsRouter } from "./routes/residents.routes.js";
import { rentRollsRouter } from "./routes/rent-rolls.routes.js";
import { availabilityRouter } from "./routes/availability.routes.js";
import { portfolioRouter } from "./routes/portfolio.routes.js";
import { leaseRiskRouter } from "./routes/lease-risk.routes.js";
import { rentGapRouter } from "./routes/rent-gap.routes.js";
import { assistantRouter, morningBriefRouter } from "./routes/assistant.routes.js";
import { llmTracesRouter } from "./routes/llm-traces.routes.js";
import { DeepSeekChatModel } from "./deepseek.js";
import type { ChatModel } from "./assistant-types.js";
import { LLM_TRACE_DIR } from "./config.js";
import {
  FileLlmTraceStore,
  type LlmTraceReader,
  type LlmTraceWriter,
} from "./llm-trace.js";

export function createApp(
  db: AppDatabase,
  model?: ChatModel,
  traceStore: LlmTraceReader & LlmTraceWriter = new FileLlmTraceStore(LLM_TRACE_DIR)
): Express {
  const app = express();
  const activeModel = model ?? new DeepSeekChatModel({ traceWriter: traceStore });
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/properties", propertiesRouter(db));
  app.use("/api/units", unitsRouter(db));
  app.use("/api/residents", residentsRouter(db));
  app.use("/api/rent-rolls", rentRollsRouter(db));
  app.use("/api/availability", availabilityRouter(db));
  app.use("/api/portfolio", portfolioRouter(db));
  app.use("/api/lease-risks", leaseRiskRouter(db));
  app.use("/api/rent-gap", rentGapRouter(db));
  app.use("/api/morning-brief", morningBriefRouter(db, activeModel));
  app.use("/api/assistant", assistantRouter(db, activeModel));
  app.use("/api/debug/llm-traces", llmTracesRouter(traceStore));

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  );

  return app;
}
