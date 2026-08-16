/**
 * Walkthrough note: Builds the occupied-unit risk table, filters, pagination,
 * lease cohorts, and rent-gap aggregates from the normalized snapshot.
 */
import type { AppDatabase } from "../db/index.js";
import { BOOKED_OCCUPIED_SQL, bookingCutoff, type AvailabilityOptions } from "./availability.js";
import { BASE_RENT_CHARGE_CODES } from "./charge-codes.js";
import {
  bucketizeLeaseEnd,
  EMPTY_LEASE_BUCKETS,
  LEASE_BUCKETS,
  type LeaseBucket,
  type LeaseExpirationBuckets,
} from "./lease-buckets.js";
import { runDataQualityChecks, type DataQualityIssue } from "./quality.js";

export type AvailabilityStatus =
  | "occupied_no_notice"
  | "notice_rented"
  | "notice_unrented";

export interface LeaseRiskRow {
  property_code: string;
  property_name: string | null;
  unit_code: string;
  unit_type: string | null;
  resident_id: string;
  resident_name: string | null;
  lease_end_date: string | null;
  move_out_date: string | null;
  move_in_date: string | null;
  market_rent: number | null;
  scheduled_base_rent: number;
  loss_to_lease: number | null;
  loss_to_lease_pct: number | null;
  balance: number | null;
  availability_status: AvailabilityStatus;
  bucket: LeaseBucket;
}

export interface LeaseRiskFilters {
  property?: string;
  bucket?: LeaseBucket;
  unit_type?: string;
  has_move_out?: boolean;
  has_positive_balance?: boolean;
  rent_gap_min?: number;
  rent_gap_max?: number;
}

export interface LeaseRiskMetrics {
  total_records: number;
  total_scheduled_base_rent: number;
  total_market_rent: number;
  total_loss_to_lease: number;
  positive_loss_to_lease_count: number;
  premium_count: number;
  buckets: LeaseExpirationBuckets;
}

export interface LeaseRiskSummary {
  as_of_date: string;
  month_year: string;
  filters: Record<string, unknown>;
  metrics: LeaseRiskMetrics;
  rows: LeaseRiskRow[];
  pagination: {
    page: number;
    page_size: number;
    total_pages: number;
  };
  options: {
    properties: { code: string; name: string | null }[];
    unit_types: string[];
  };
  definitions: Record<string, string>;
  coverage: Record<string, number>;
  data_quality: DataQualityIssue[];
}

export const LEASE_RISK_PAGE_SIZE = 50;

interface LeaseRiskSqlRow {
  property_code: string;
  property_name: string | null;
  unit_code: string;
  unit_type: string | null;
  resident_id: string;
  resident_name: string | null;
  lease_end_date: string | null;
  move_out_date: string | null;
  move_in_date: string | null;
  market_rent: number | null;
  balance: number | null;
  scheduled_base_rent: number;
  availability_status: AvailabilityStatus;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeLossToLease(
  marketRent: number | null,
  scheduledBaseRent: number | null
): { loss: number | null; pct: number | null } {
  if (marketRent === null || scheduledBaseRent === null || scheduledBaseRent <= 0) {
    return { loss: null, pct: null };
  }
  // The analytics layer keeps the useful signed value. The assistant boundary
  // later exposes mutually exclusive non-negative Loss/Gain-to-Lease fields.
  const loss = round2(marketRent - scheduledBaseRent);
  const pct = round2((loss / scheduledBaseRent) * 100);
  return { loss, pct };
}

export function applyLeaseRiskFilters(
  rows: LeaseRiskRow[],
  filters: LeaseRiskFilters
): LeaseRiskRow[] {
  return rows.filter((row) => {
    if (filters.property && row.property_code !== filters.property) return false;
    if (filters.bucket && row.bucket !== filters.bucket) return false;
    if (filters.unit_type && (row.unit_type ?? "") !== filters.unit_type) return false;
    if (filters.has_move_out === true && row.move_out_date === null) return false;
    if (filters.has_move_out === false && row.move_out_date !== null) return false;
    if (filters.has_positive_balance === true && (row.balance ?? 0) <= 0) return false;
    if (filters.has_positive_balance === false && (row.balance ?? 0) > 0) return false;
    if (
      filters.rent_gap_min !== undefined &&
      (row.loss_to_lease === null || row.loss_to_lease < filters.rent_gap_min)
    ) {
      return false;
    }
    if (
      filters.rent_gap_max !== undefined &&
      (row.loss_to_lease === null || row.loss_to_lease > filters.rent_gap_max)
    ) {
      return false;
    }
    return true;
  });
}

export function paginateLeaseRiskRows(
  rows: LeaseRiskRow[],
  requestedPage: number,
  pageSize = LEASE_RISK_PAGE_SIZE
): { rows: LeaseRiskRow[]; page: number; page_size: number; total_pages: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safeRequestedPage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const page = Math.min(safeRequestedPage, totalPages);
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page,
    page_size: pageSize,
    total_pages: totalPages,
  };
}

function baseRentInClause(): string {
  return BASE_RENT_CHARGE_CODES.map((code) => `'${code}'`).join(", ");
}

export function queryLeaseRiskRows(
  db: AppDatabase,
  options: AvailabilityOptions & { monthYear: string }
): LeaseRiskRow[] {
  const cutoff = bookingCutoff(options.asOfDate, options.staleDays);
  const rows = db
    .prepare(
      `SELECT
         p.code AS property_code,
         p.name AS property_name,
         u.unit_code,
         u.type AS unit_type,
         r.id AS resident_id,
         r.name AS resident_name,
         r.lease_end_date,
         r.move_out_date,
         r.move_in_date,
         u.market_rent,
         r.balance,
         COALESCE((
           SELECT SUM(rr.amount) FROM rent_rolls rr
           WHERE rr.resident_id = r.id
             AND rr.month_year = @monthYear
             AND rr.charge_code IS NOT NULL
             AND UPPER(TRIM(rr.charge_code)) IN (${baseRentInClause()})
         ), 0) AS scheduled_base_rent,
         CASE
           WHEN r.move_out_date IS NULL THEN 'occupied_no_notice'
           WHEN ${BOOKED_OCCUPIED_SQL} THEN 'notice_rented'
           ELSE 'notice_unrented'
         END AS availability_status
       FROM residential_units u
       JOIN residents r ON r.id = u.resident_id
       JOIN properties p ON p.code = u.property_code
       WHERE u.status = 'OCCUPIED'
       ORDER BY p.code, u.unit_code`
    )
    .all({ cutoff, monthYear: options.monthYear }) as LeaseRiskSqlRow[];

  return rows.map((row) => {
    const { loss, pct } = computeLossToLease(row.market_rent, row.scheduled_base_rent);
    return {
      property_code: row.property_code,
      property_name: row.property_name,
      unit_code: row.unit_code,
      unit_type: row.unit_type,
      resident_id: row.resident_id,
      resident_name: row.resident_name,
      lease_end_date: row.lease_end_date,
      move_out_date: row.move_out_date,
      move_in_date: row.move_in_date,
      market_rent: row.market_rent,
      scheduled_base_rent: round2(row.scheduled_base_rent),
      loss_to_lease: loss,
      loss_to_lease_pct: pct,
      balance: row.balance,
      availability_status: row.availability_status,
      bucket: bucketizeLeaseEnd(options.asOfDate, row.lease_end_date),
    };
  });
}

export function computeLeaseRiskSummary(
  db: AppDatabase,
  options: AvailabilityOptions & { monthYear: string },
  filters: LeaseRiskFilters,
  requestedPage = 1
): LeaseRiskSummary {
  const allRows = queryLeaseRiskRows(db, options);
  const rows = applyLeaseRiskFilters(allRows, filters);

  const buckets: LeaseExpirationBuckets = { ...EMPTY_LEASE_BUCKETS };
  let totalScheduledBaseRent = 0;
  let totalMarketRent = 0;
  let totalLossToLease = 0;
  let positiveLossCount = 0;
  let premiumCount = 0;
  let withMarketRent = 0;
  let withBaseRent = 0;
  let withLossToLease = 0;

  for (const row of rows) {
    buckets[row.bucket] += 1;
    totalScheduledBaseRent += row.scheduled_base_rent;
    if (row.market_rent !== null) {
      totalMarketRent += row.market_rent;
      withMarketRent += 1;
    }
    if (row.scheduled_base_rent > 0) withBaseRent += 1;
    if (row.loss_to_lease !== null) {
      totalLossToLease += row.loss_to_lease;
      withLossToLease += 1;
      if (row.loss_to_lease > 0) positiveLossCount += 1;
      if (row.loss_to_lease < 0) premiumCount += 1;
    }
  }

  const total = rows.length;

  const metrics: LeaseRiskMetrics = {
    total_records: total,
    total_scheduled_base_rent: round2(totalScheduledBaseRent),
    total_market_rent: round2(totalMarketRent),
    total_loss_to_lease: round2(totalLossToLease),
    positive_loss_to_lease_count: positiveLossCount,
    premium_count: premiumCount,
    buckets,
  };

  const coverage = {
    market_rent_coverage: total === 0 ? 0 : round2((withMarketRent / total) * 100),
    base_rent_coverage: total === 0 ? 0 : round2((withBaseRent / total) * 100),
    loss_to_lease_coverage: total === 0 ? 0 : round2((withLossToLease / total) * 100),
  };

  const properties = db
    .prepare("SELECT code, name FROM properties ORDER BY code")
    .all() as { code: string; name: string | null }[];

  const unitTypes = [...new Set(allRows.map((r) => r.unit_type).filter((t): t is string => t !== null))].sort();

  const availableOptions = { properties, unit_types: unitTypes };
  const pagination = paginateLeaseRiskRows(rows, requestedPage);

  const definitions: Record<string, string> = {
    scheduled_base_rent:
      "Sum of current-month Rent Roll charges whose charge code is mapped to base rent.",
    loss_to_lease: "market_rent - scheduled_base_rent (null when base rent is missing or zero).",
    loss_to_lease_pct: "loss_to_lease / scheduled_base_rent.",
    premium: "A unit whose market rent is below its scheduled base rent (negative loss-to-lease).",
    balance: "Resident balance exposure; not interpreted as delinquency.",
  };

  return {
    as_of_date: options.asOfDate,
    month_year: options.monthYear,
    filters: filters as Record<string, unknown>,
    metrics,
    rows: pagination.rows,
    pagination: {
      page: pagination.page,
      page_size: pagination.page_size,
      total_pages: pagination.total_pages,
    },
    options: availableOptions,
    definitions,
    coverage,
    data_quality: runDataQualityChecks(db, options),
  };
}

export { LEASE_BUCKETS };
