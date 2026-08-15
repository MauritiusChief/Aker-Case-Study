import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type LlmTraceOutcome =
  | "success"
  | "http_error"
  | "invalid_json"
  | "invalid_response"
  | "timeout"
  | "network_error";

export interface LlmTraceResponse {
  httpStatus: number;
  body?: unknown;
  rawText?: string;
}

export interface LlmTrace {
  schemaVersion: 1;
  traceId: string;
  provider: string;
  endpoint: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  outcome: LlmTraceOutcome;
  request: unknown;
  response: LlmTraceResponse | null;
  error: { code: string; message: string } | null;
}

export interface LlmTraceWriter {
  save(trace: LlmTrace): Promise<void>;
}

export interface LlmTraceSummary {
  traceId: string;
  startedAt: string | null;
  model: string | null;
  outcome: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  corrupt: boolean;
}

export interface LlmTracePage {
  entries: LlmTraceSummary[];
  page: number;
  pageSize: number;
  total: number;
}

export interface StoredLlmTrace {
  trace: LlmTrace | null;
  raw: string;
  parseError: string | null;
}

export interface LlmTraceReader {
  list(page: number, pageSize: number): Promise<LlmTracePage>;
  read(traceId: string): Promise<StoredLlmTrace | null>;
}

const TRACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACE_FILE_PATTERN = /^.+_([0-9a-f-]{36})\.json$/i;

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function traceFileName(trace: LlmTrace): string {
  const sortableTime = trace.startedAt.replace(/[:.]/g, "-");
  return `${sortableTime}_${trace.traceId}.json`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function summaryFromFile(fileName: string, raw: string): LlmTraceSummary {
  const fileTraceId = TRACE_FILE_PATTERN.exec(fileName)?.[1] ?? fileName;
  try {
    const trace = record(JSON.parse(raw));
    const request = record(trace?.request);
    const response = record(trace?.response);
    return {
      traceId: typeof trace?.traceId === "string" ? trace.traceId : fileTraceId,
      startedAt: typeof trace?.startedAt === "string" ? trace.startedAt : null,
      model: typeof request?.model === "string" ? request.model : null,
      outcome: typeof trace?.outcome === "string" ? trace.outcome : null,
      httpStatus: typeof response?.httpStatus === "number" ? response.httpStatus : null,
      durationMs: typeof trace?.durationMs === "number" ? trace.durationMs : null,
      corrupt: trace === null,
    };
  } catch {
    return {
      traceId: fileTraceId,
      startedAt: null,
      model: null,
      outcome: null,
      httpStatus: null,
      durationMs: null,
      corrupt: true,
    };
  }
}

export function createTraceId(): string {
  return randomUUID();
}

export class FileLlmTraceStore implements LlmTraceWriter, LlmTraceReader {
  constructor(private readonly directory: string) {}

  async save(trace: LlmTrace): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const fileName = traceFileName(trace);
    const destination = path.join(this.directory, fileName);
    const temporary = path.join(this.directory, `.${fileName}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
      await rename(temporary, destination);
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!isMissingFile(error)) throw error;
      });
    }
  }

  async list(page: number, pageSize: number): Promise<LlmTracePage> {
    let fileNames: string[];
    try {
      fileNames = (await readdir(this.directory))
        .filter((fileName) => TRACE_FILE_PATTERN.test(fileName))
        .sort((left, right) => right.localeCompare(left));
    } catch (error) {
      if (isMissingFile(error)) return { entries: [], page, pageSize, total: 0 };
      throw error;
    }

    const offset = (page - 1) * pageSize;
    const selected = fileNames.slice(offset, offset + pageSize);
    const entries = await Promise.all(
      selected.map(async (fileName) => {
        const raw = await readFile(path.join(this.directory, fileName), "utf8");
        return summaryFromFile(fileName, raw);
      })
    );
    return { entries, page, pageSize, total: fileNames.length };
  }

  async read(traceId: string): Promise<StoredLlmTrace | null> {
    if (!TRACE_ID_PATTERN.test(traceId)) return null;

    let fileNames: string[];
    try {
      fileNames = await readdir(this.directory);
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
    const fileName = fileNames.find(
      (candidate) => TRACE_FILE_PATTERN.test(candidate) && candidate.endsWith(`_${traceId}.json`)
    );
    if (!fileName) return null;

    const raw = await readFile(path.join(this.directory, fileName), "utf8");
    try {
      return { trace: JSON.parse(raw) as LlmTrace, raw, parseError: null };
    } catch (error) {
      return {
        trace: null,
        raw,
        parseError: error instanceof Error ? error.message : "Invalid JSON",
      };
    }
  }
}
