/**
 * Walkthrough note: Reports snapshot inconsistencies without silently changing
 * imported facts, including availability reconciliation and relationship checks.
 */
import type { AppDatabase } from "../db/index.js";
import { isIsoDate } from "../lib/dates.js";
import { queryAvailabilitySummaries, type AvailabilityOptions } from "./availability.js";

export type QualitySeverity = "error" | "warning";

export interface DataQualityIssue {
  code: string;
  severity: QualitySeverity;
  message: string;
  property_code?: string;
  unit_code?: string;
  resident_id?: string;
}

interface ResidentDateRow {
  id: string;
  move_in_date: string | null;
  lease_end_date: string | null;
  move_out_date: string | null;
  unit_code: string | null;
  property_code: string | null;
}

interface UnitRow {
  unit_code: string;
  property_code: string;
  status: string;
  resident_id: string | null;
}

function addDateIssues(
  issues: DataQualityIssue[],
  rows: ResidentDateRow[],
  label: string
): void {
  for (const row of rows) {
    for (const [field, value] of [
      ["move_in_date", row.move_in_date],
      ["lease_end_date", row.lease_end_date],
      ["move_out_date", row.move_out_date],
    ] as const) {
      if (value !== null && value !== "" && !isIsoDate(value)) {
        issues.push({
          code: "INVALID_DATE",
          severity: "error",
          message: `${label} resident has non-YYYY/MM/DD ${field}: "${value}"`,
          resident_id: row.id,
          property_code: row.property_code ?? undefined,
          unit_code: row.unit_code ?? undefined,
        });
      }
    }
  }
}

export function runDataQualityChecks(
  db: AppDatabase,
  options: AvailabilityOptions
): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];

  const availability = queryAvailabilitySummaries(db, options);

  for (const summary of availability) {
    const categorySum =
      summary.occupied_no_notice +
      summary.notice_rented +
      summary.notice_unrented +
      summary.vacant_rented +
      summary.vacant_unrented +
      summary.model +
      summary.down +
      summary.admin;

    if (categorySum !== summary.total_units) {
      issues.push({
        code: "CATEGORY_TOTAL_MISMATCH",
        severity: "error",
        message: `Availability categories sum to ${categorySum} but property has ${summary.total_units} units`,
        property_code: summary.property_code,
      });
    }

    for (const [name, value] of [
      ["occupancy_pct", summary.occupancy_pct],
      ["occ_w_non_rev_pct", summary.occ_w_non_rev_pct],
      ["leased_pct", summary.leased_pct],
    ] as const) {
      if (value < 0 || value > 100) {
        issues.push({
          code: "PCT_OUT_OF_RANGE",
          severity: "error",
          message: `${name} is ${value}, outside 0..100`,
          property_code: summary.property_code,
        });
      }
    }

    if (summary.avail < 0 || summary.occupied < 0 || summary.vacant < 0) {
      issues.push({
        code: "NEGATIVE_COUNT",
        severity: "error",
        message: "A derived availability count is negative",
        property_code: summary.property_code,
      });
    }
  }

  const units = db
    .prepare(
      "SELECT unit_code, property_code, status, resident_id FROM residential_units"
    )
    .all() as UnitRow[];

  for (const unit of units) {
    if (unit.status === "OCCUPIED" && (unit.resident_id === null || unit.resident_id === "")) {
      issues.push({
        code: "OCCUPIED_WITHOUT_RESIDENT",
        severity: "error",
        message: "OCCUPIED unit has no current resident",
        property_code: unit.property_code,
        unit_code: unit.unit_code,
      });
    }
    if (unit.status !== "OCCUPIED" && unit.resident_id !== null && unit.resident_id !== "") {
      issues.push({
        code: "NON_OCCUPIED_WITH_RESIDENT",
        severity: "warning",
        message: `${unit.status} unit is linked to a current resident`,
        property_code: unit.property_code,
        unit_code: unit.unit_code,
      });
    }
  }

  const allResidents = db
    .prepare(
      `SELECT id, move_in_date, lease_end_date, move_out_date, unit_code, property_code
       FROM residents`
    )
    .all() as ResidentDateRow[];

  addDateIssues(issues, allResidents, "resident");

  const occupiedWithoutLeaseEnd = db
    .prepare(
      `SELECT r.id, r.unit_code, r.property_code, r.lease_end_date
       FROM residential_units u
       JOIN residents r ON r.id = u.resident_id
       WHERE u.status = 'OCCUPIED'
         AND (r.lease_end_date IS NULL OR r.lease_end_date = '')`
    )
    .all() as ResidentDateRow[];

  for (const row of occupiedWithoutLeaseEnd) {
    issues.push({
      code: "MISSING_LEASE_END",
      severity: "warning",
      message: "Occupied unit resident has no lease expiration date",
      resident_id: row.id,
      property_code: row.property_code ?? undefined,
      unit_code: row.unit_code ?? undefined,
    });
  }

  const futureResidents = db
    .prepare(
      `SELECT id, move_in_date, lease_end_date, move_out_date, unit_code, property_code
       FROM residents r
       WHERE NOT EXISTS (
         SELECT 1 FROM residential_units u
         WHERE u.resident_id = r.id
       )`
    )
    .all() as ResidentDateRow[];

  for (const future of futureResidents) {
    const unit = db
      .prepare(
        "SELECT unit_code, property_code FROM residential_units WHERE unit_code = ? AND property_code = ?"
      )
      .get(future.unit_code ?? "", future.property_code ?? "");
    if (!unit) {
      issues.push({
        code: "FUTURE_RESIDENT_NO_UNIT",
        severity: "error",
        message: "Future resident references a unit/property that does not exist",
        resident_id: future.id,
        property_code: future.property_code ?? undefined,
        unit_code: future.unit_code ?? undefined,
      });
      continue;
    }

    if (future.move_in_date !== null && !isIsoDate(future.move_in_date)) {
      issues.push({
        code: "INVALID_DATE",
        severity: "error",
        message: `Future resident has non-YYYY/MM/DD move_in_date: "${future.move_in_date}"`,
        resident_id: future.id,
        property_code: future.property_code ?? undefined,
        unit_code: future.unit_code ?? undefined,
      });
    }

    const current = db
      .prepare(
        `SELECT id, move_out_date FROM residents
         WHERE unit_code = ? AND property_code = ? AND move_out_date IS NOT NULL
         ORDER BY move_out_date DESC LIMIT 1`
      )
      .get(future.unit_code ?? "", future.property_code ?? "") as
      | { id: string; move_out_date: string | null }
      | undefined;

    if (
      current?.move_out_date &&
      future.move_in_date &&
      isIsoDate(current.move_out_date) &&
      isIsoDate(future.move_in_date) &&
      current.move_out_date > future.move_in_date
    ) {
      issues.push({
        code: "MOVE_IN_BEFORE_MOVE_OUT",
        severity: "warning",
        message: `Future resident move_in_date (${future.move_in_date}) precedes current resident move_out_date (${current.move_out_date})`,
        resident_id: future.id,
        property_code: future.property_code ?? undefined,
        unit_code: future.unit_code ?? undefined,
      });
    }
  }

  return issues;
}
