import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_ROOT = path.resolve(__dirname, "..");

export const DATA_DIR = path.join(SERVER_ROOT, "data");

export const DB_PATH = process.env.AKER_DB_PATH ?? path.join(DATA_DIR, "aker.db");

export const CSV_ROOT = path.resolve(SERVER_ROOT, "..", "data", "csv");

export const RENT_ROLL_CSV_DIR = path.join(CSV_ROOT, "rent_roll");

export const UNIT_AVAILABILITY_CSV_DIR = path.join(CSV_ROOT, "unit_availability");

export const DEFAULT_MONTH_YEAR = process.env.AKER_MONTH_YEAR ?? "02/2026";

export const PORT = Number(process.env.PORT ?? 3000);
