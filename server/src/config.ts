import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_ROOT = path.resolve(__dirname, "..");

export const DATA_DIR = path.join(SERVER_ROOT, "data");

export const DB_PATH = process.env.AKER_DB_PATH ?? path.join(DATA_DIR, "aker.db");

export const CSV_ROOT = path.resolve(SERVER_ROOT, "..", "data", "csv");

export const RENT_ROLL_CSV_DIR = path.join(CSV_ROOT, "rent_roll");

export const UNIT_AVAILABILITY_CSV_DIR = path.join(CSV_ROOT, "unit_availability");

export const DEFAULT_MONTH_YEAR = process.env.AKER_MONTH_YEAR ?? "2026/02";

export const AS_OF_DATE = process.env.AKER_AS_OF_DATE ?? "2026/02/25";

export const BOOKING_STALE_DAYS = Number(process.env.AKER_BOOKING_STALE_DAYS ?? 90);

export const PORT = Number(process.env.PORT ?? 3000);

export const LLM_MODEL = process.env.AKER_LLM_MODEL ?? "deepseek-v4-flash";

export const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

export const DEEPSEEK_BASE_URL =
  process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";

export const LLM_TIMEOUT_MS = Number(process.env.AKER_LLM_TIMEOUT_MS ?? 30_000);

export const AKER_LLM_DEBUG = process.env.AKER_LLM_DEBUG === "true";
