/**
 * Walkthrough note: Imports property identity only from Unit Availability;
 * report aggregates are deliberately ignored in favor of derived metrics.
 */
import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "./csv.js";
import { UNIT_AVAILABILITY_CSV_DIR } from "../config.js";

export interface ParsedProperty {
  code: string;
  name: string | null;
}

export function parseUnitAvailabilityCsv(text: string): ParsedProperty | null {
  // Return only the first non-header property's identity; availability values
  // in later columns or rows are intentionally not persisted.
  const rows = parseCsv(text);
  for (const row of rows) {
    if (row.length === 0) continue;
    const code = (row[0] ?? "").trim();
    const name = (row[1] ?? "").trim();
    if (code === "" || code === "Property") continue;
    return { code, name: name === "" ? null : name };
  }
  return null;
}

export function readUnitAvailabilityFiles(): ParsedProperty[] {
  if (!fs.existsSync(UNIT_AVAILABILITY_CSV_DIR)) {
    return [];
  }
  const files = fs
    .readdirSync(UNIT_AVAILABILITY_CSV_DIR)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .sort();

  const properties: ParsedProperty[] = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(UNIT_AVAILABILITY_CSV_DIR, file), "utf8");
    const property = parseUnitAvailabilityCsv(text);
    if (property) properties.push(property);
  }
  return properties;
}
