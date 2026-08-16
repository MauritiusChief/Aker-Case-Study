/**
 * Walkthrough note: Produces the property drill-down by composing shared
 * availability and lease-risk calculations with property charge details.
 */
import type { AppDatabase } from "../db/index.js";
import type { AvailabilitySummary } from "../types.js";
import {
  queryAvailabilitySummaries,
  bookingCutoff,
  BOOKED_VACANT_SQL,
  type AvailabilityOptions,
} from "./availability.js";
import { isBaseRentCharge } from "./charge-codes.js";
import { queryLeaseRiskRows } from "./lease-risk.js";
import {
  bucketizeLeaseEnd,
  EMPTY_LEASE_BUCKETS,
  type LeaseExpirationBuckets,
} from "./lease-buckets.js";
import { runDataQualityChecks, type DataQualityIssue } from "./quality.js";

export interface PropertyChargeCodeRow {
  charge_code: string;
  category: "base_rent" | "other";
  amount: number;
  resident_count: number;
}

export interface PropertyMetrics {
  total_units: number;
  occupied: number;
  vacant: number;
  avail: number;
  occupancy_pct: number;
  leased_pct: number;
  vacant_unrented_exposure: number;
  expiring_60: number;
  total_base_rent: number;
  comparable_units: number;
  total_loss_to_lease: number;
  avg_loss_to_lease: number | null;
  positive_loss_to_lease_count: number;
  premium_count: number;
}

export interface PropertySummary {
  as_of_date: string;
  month_year: string;
  property: { code: string; name: string | null };
  filters: Record<string, unknown>;
  metrics: PropertyMetrics;
  availability: AvailabilitySummary | null;
  lease_expiration_buckets: LeaseExpirationBuckets;
  charge_codes: PropertyChargeCodeRow[];
  definitions: Record<string, string>;
  coverage: Record<string, number>;
  data_quality: DataQualityIssue[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computePropertySummary(
  db: AppDatabase,
  options: AvailabilityOptions & { monthYear: string },
  propertyCode: string
): PropertySummary | null {
  const property = db
    .prepare("SELECT code, name FROM properties WHERE code = ?")
    .get(propertyCode) as { code: string; name: string | null } | undefined;
  if (!property) return null;

  const availability = queryAvailabilitySummaries(db, options).find(
    (a) => a.property_code === propertyCode
  );

  const leaseRows = queryLeaseRiskRows(db, options).filter(
    (r) => r.property_code === propertyCode
  );

  const buckets: LeaseExpirationBuckets = { ...EMPTY_LEASE_BUCKETS };
  let expiring60 = 0;
  let totalBaseRent = 0;
  let comparableUnits = 0;
  let totalLossToLease = 0;
  let positiveCount = 0;
  let premiumCount = 0;
  const losses: number[] = [];

  for (const row of leaseRows) {
    buckets[row.bucket] += 1;
    if (row.bucket === "0_30" || row.bucket === "31_60") expiring60 += 1;
    totalBaseRent += row.scheduled_base_rent;
    if (row.loss_to_lease !== null) {
      comparableUnits += 1;
      totalLossToLease += row.loss_to_lease;
      losses.push(row.loss_to_lease);
      if (row.loss_to_lease > 0) positiveCount += 1;
      if (row.loss_to_lease < 0) premiumCount += 1;
    }
  }

  const cutoff = bookingCutoff(options.asOfDate, options.staleDays);
  const vacantUnrentedExposure = round2(
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(u.market_rent), 0) AS exposure
           FROM residential_units u
           WHERE u.property_code = @property
             AND u.status = 'VACANT'
             AND NOT ${BOOKED_VACANT_SQL}`
        )
        .get({ property: propertyCode, cutoff }) as { exposure: number }
    ).exposure
  );

  const chargeRows = db
    .prepare(
      `SELECT rr.charge_code,
              SUM(rr.amount) AS amount,
              COUNT(DISTINCT rr.resident_id) AS resident_count
       FROM rent_rolls rr
       JOIN residents r ON r.id = rr.resident_id
       WHERE r.property_code = @property AND rr.month_year = @monthYear
       GROUP BY rr.charge_code
       ORDER BY amount DESC`
    )
    .all({ property: propertyCode, monthYear: options.monthYear }) as {
    charge_code: string;
    amount: number;
    resident_count: number;
  }[];

  const chargeCodes: PropertyChargeCodeRow[] = chargeRows.map((row) => ({
    charge_code: row.charge_code,
    category: isBaseRentCharge(row.charge_code) ? "base_rent" : "other",
    amount: round2(row.amount),
    resident_count: row.resident_count,
  }));

  const metrics: PropertyMetrics = {
    total_units: availability?.total_units ?? 0,
    occupied: availability?.occupied ?? 0,
    vacant: availability?.vacant ?? 0,
    avail: availability?.avail ?? 0,
    occupancy_pct: availability?.occupancy_pct ?? 0,
    leased_pct: availability?.leased_pct ?? 0,
    vacant_unrented_exposure: vacantUnrentedExposure,
    expiring_60: expiring60,
    total_base_rent: round2(totalBaseRent),
    comparable_units: comparableUnits,
    total_loss_to_lease: round2(totalLossToLease),
    avg_loss_to_lease: losses.length === 0 ? null : round2(totalLossToLease / losses.length),
    positive_loss_to_lease_count: positiveCount,
    premium_count: premiumCount,
  };

  const coverage = {
    loss_to_lease_coverage:
      leaseRows.length === 0 ? 0 : round2((comparableUnits / leaseRows.length) * 100),
  };

  const definitions: Record<string, string> = {
    total_base_rent: "Sum of base-rent charge codes for this property's occupied units.",
    loss_to_lease: "market_rent - scheduled_base_rent across occupied units.",
    expiring_60: "Leases ending within 60 days of as_of_date.",
  };

  return {
    as_of_date: options.asOfDate,
    month_year: options.monthYear,
    property,
    filters: { property: propertyCode },
    metrics,
    availability: availability ?? null,
    lease_expiration_buckets: buckets,
    charge_codes: chargeCodes,
    definitions,
    coverage,
    data_quality: runDataQualityChecks(db, options).filter(
      (i) => i.property_code === propertyCode
    ),
  };
}
