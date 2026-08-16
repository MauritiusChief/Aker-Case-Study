/**
 * Walkthrough note: Parses Rent Roll sections into normalized units, current
 * residents, future residents, and charge rows for one snapshot.
 */
import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "./csv.js";
import type { UnitStatus } from "../types.js";
import { RENT_ROLL_CSV_DIR } from "../config.js";

export interface ParsedResident {
  id: string;
  name: string | null;
  security_deposit: number | null;
  other_deposit: number | null;
  balance: number | null;
  move_in_date: string | null;
  lease_end_date: string | null;
  move_out_date: string | null;
  unit_code: string | null;
  property_code: string;
}

export interface ParsedUnit {
  unit_code: string;
  property_code: string;
  type: string | null;
  area: number | null;
  market_rent: number | null;
  resident_id: string | null;
  status: UnitStatus;
}

export interface ParsedRentRoll {
  charge_code: string | null;
  amount: number | null;
  resident_id: string;
}

export interface ParsedRentRollFile {
  propertyCode: string;
  units: ParsedUnit[];
  residents: ParsedResident[];
  futureResidents: ParsedResident[];
  rentRolls: ParsedRentRoll[];
}

const VACANT = "VACANT";

const NON_REVENUE_STATUSES: readonly string[] = ["MODEL", "DOWN", "ADMIN"];

function classifyResident(value: string | null): {
  status: UnitStatus;
  isVacant: boolean;
} {
  if (value === null || value === "") {
    return { status: "VACANT", isVacant: true };
  }
  const upper = value.toUpperCase();
  if (upper === VACANT) {
    return { status: "VACANT", isVacant: true };
  }
  // MODEL, DOWN, and ADMIN need explicit unit status because they have no
  // current resident from which availability could otherwise be inferred.
  if (NON_REVENUE_STATUSES.includes(upper)) {
    return { status: upper as UnitStatus, isVacant: true };
  }
  return { status: "OCCUPIED", isVacant: false };
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const num = Number(trimmed);
  return Number.isNaN(num) ? null : num;
}

function toText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function parseRentRollCsv(text: string, propertyCode: string): ParsedRentRollFile {
  const rows = parseCsv(text);
  const units: ParsedUnit[] = [];
  const residents: ParsedResident[] = [];
  const futureResidents: ParsedResident[] = [];
  const rentRolls: ParsedRentRoll[] = [];

  let inCurrentSection = false;
  let inFutureSection = false;
  let currentUnit: string | null = null;
  let currentResidentId: string | null = null;

  for (const row of rows) {
    if (row.length === 0) continue;

    const first = row[0] ?? "";
    const firstTrimmed = first.trim();

    if (firstTrimmed === "Current/Notice/Vacant Residents") {
      inCurrentSection = true;
      inFutureSection = false;
      continue;
    }
    if (firstTrimmed === "Future Residents/Applicants") {
      inCurrentSection = false;
      inFutureSection = true;
      currentUnit = null;
      currentResidentId = null;
      continue;
    }
    if (firstTrimmed === "Summary Groups") {
      break;
    }

    const unit = toText(row[0]);
    const type = toText(row[1]);
    const area = toNumber(row[2]);
    const residentId = toText(row[3]);
    const name = toText(row[4]);
    const marketRent = toNumber(row[5]);
    const chargeCode = toText(row[6]);
    const amount = toNumber(row[7]);
    const securityDeposit = toNumber(row[8]);
    const otherDeposit = toNumber(row[9]);
    const moveIn = toText(row[10]);
    const leaseEnd = toText(row[11]);
    const moveOut = toText(row[12]);
    const balance = toNumber(row[13]);

    if (inFutureSection) {
      // Header row: begins with "Unit".
      if (firstTrimmed === "Unit") continue;
      if (unit === null || residentId === null) continue;
      futureResidents.push({
        id: residentId,
        name,
        security_deposit: securityDeposit,
        other_deposit: otherDeposit,
        balance,
        move_in_date: moveIn,
        lease_end_date: leaseEnd,
        move_out_date: null,
        unit_code: unit,
        property_code: propertyCode,
      });
      continue;
    }

    if (!inCurrentSection) continue;

    // Header row: begins with "Unit" (and second column is "Unit Type").
    if (firstTrimmed === "Unit") continue;

    if (unit !== null) {
      // A new unit/resident row.
      currentUnit = unit;
      const { status, isVacant } = classifyResident(residentId);
      currentResidentId = isVacant ? null : residentId;

      units.push({
        unit_code: unit,
        property_code: propertyCode,
        type,
        area,
        market_rent: marketRent,
        resident_id: currentResidentId,
        status,
      });

      if (!isVacant && currentResidentId !== null) {
        residents.push({
          id: currentResidentId,
          name,
          security_deposit: securityDeposit,
          other_deposit: otherDeposit,
          balance,
          move_in_date: moveIn,
          lease_end_date: leaseEnd,
          move_out_date: moveOut,
          unit_code: unit,
          property_code: propertyCode,
        });
      }
    } else {
      // Continuation row: an additional charge for the previous resident.
      if (currentResidentId === null) continue;
    }

    if (chargeCode !== null && currentResidentId !== null) {
      rentRolls.push({
        charge_code: chargeCode,
        amount,
        resident_id: currentResidentId,
      });
    }
  }

  return { propertyCode, units, residents, futureResidents, rentRolls };
}

export function readRentRollFiles(): { propertyCode: string; parsed: ParsedRentRollFile }[] {
  if (!fs.existsSync(RENT_ROLL_CSV_DIR)) {
    return [];
  }
  const files = fs
    .readdirSync(RENT_ROLL_CSV_DIR)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .sort();

  return files.map((file) => {
    const propertyCode = path.basename(file, ".csv");
    const text = fs.readFileSync(path.join(RENT_ROLL_CSV_DIR, file), "utf8");
    return { propertyCode, parsed: parseRentRollCsv(text, propertyCode) };
  });
}
