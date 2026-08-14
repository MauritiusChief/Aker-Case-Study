import type { AppDatabase } from "../db/index.js";
import type { AvailabilitySummary } from "../types.js";
import type { DataQualityIssue } from "./quality.js";
import { runDataQualityChecks } from "./quality.js";
import {
  queryAvailabilitySummaries,
  bookingCutoff,
  BOOKED_VACANT_SQL,
  type AvailabilityOptions,
} from "./availability.js";
import {
  bucketizeLeaseEnd,
  EMPTY_LEASE_BUCKETS,
  type LeaseExpirationBuckets,
} from "./lease-buckets.js";

export interface PropertyPriorityRow {
  property_code: string;
  property_name: string | null;
  total_units: number;
  avail: number;
  occ_pct: number;
  leased_pct: number;
  expiring_60: number;
  vacant_unrented_exposure: number;
}

export interface PortfolioMetrics {
  total_properties: number;
  total_units: number;
  physical_occupancy_pct: number;
  leased_pct: number;
  available_units: number;
  vacant_unrented_exposure: number;
  expiring_60_days: number;
  availability: AvailabilitySummary[];
  lease_expiration_buckets: LeaseExpirationBuckets;
  property_priority: PropertyPriorityRow[];
}

export interface PortfolioSummary {
  as_of_date: string;
  month_year: string;
  filters: Record<string, unknown>;
  metrics: PortfolioMetrics;
  definitions: Record<string, string>;
  coverage: Record<string, number>;
  data_quality: DataQualityIssue[];
}

interface LeaseRow {
  id: string;
  property_code: string | null;
  lease_end_date: string | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computePortfolioSummary(
  db: AppDatabase,
  options: AvailabilityOptions & { monthYear: string }
): PortfolioSummary {
  const availability = queryAvailabilitySummaries(db, options);

  const cutoff = bookingCutoff(options.asOfDate, options.staleDays);

  const exposureRows = db
    .prepare(
      `SELECT
         u.property_code,
         SUM(CASE
           WHEN u.status = 'VACANT' AND NOT ${BOOKED_VACANT_SQL}
           THEN COALESCE(u.market_rent, 0)
           ELSE 0
         END) AS vacant_unrented_exposure
       FROM residential_units u
       GROUP BY u.property_code`
    )
    .all({ cutoff }) as { property_code: string; vacant_unrented_exposure: number }[];

  const exposureByProperty = new Map<string, number>();
  for (const row of exposureRows) {
    exposureByProperty.set(row.property_code, round2(row.vacant_unrented_exposure));
  }

  const leases = db
    .prepare(
      `SELECT r.id, r.property_code, r.lease_end_date
       FROM residential_units u
       JOIN residents r ON r.id = u.resident_id
       WHERE u.status = 'OCCUPIED'`
    )
    .all() as LeaseRow[];

  const buckets: LeaseExpirationBuckets = { ...EMPTY_LEASE_BUCKETS };
  const expiringByProperty = new Map<string, number>();

  for (const lease of leases) {
    const bucket = bucketizeLeaseEnd(options.asOfDate, lease.lease_end_date);
    buckets[bucket] += 1;

    const isExpiring60 = bucket === "0_30" || bucket === "31_60";
    if (isExpiring60 && lease.property_code) {
      expiringByProperty.set(
        lease.property_code,
        (expiringByProperty.get(lease.property_code) ?? 0) + 1
      );
    }
  }

  const totalUnits = availability.reduce((sum, r) => sum + r.total_units, 0);
  const occupiedUnits = availability.reduce((sum, r) => sum + r.occupied, 0);
  const availableUnits = availability.reduce((sum, r) => sum + r.avail, 0);
  const vacantUnrented = availability.reduce((sum, r) => sum + r.vacant_unrented, 0);
  const vacantUnrentedExposure = round2(
    [...exposureByProperty.values()].reduce((sum, v) => sum + v, 0)
  );
  const expiring60Days = buckets["0_30"] + buckets["31_60"];

  const propertyPriority: PropertyPriorityRow[] = availability
    .map((summary) => ({
      property_code: summary.property_code,
      property_name: summary.property_name,
      total_units: summary.total_units,
      avail: summary.avail,
      occ_pct: summary.occ_pct,
      leased_pct: summary.leased_pct,
      expiring_60: expiringByProperty.get(summary.property_code) ?? 0,
      vacant_unrented_exposure:
        exposureByProperty.get(summary.property_code) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.vacant_unrented_exposure - a.vacant_unrented_exposure ||
        b.avail - a.avail
    );

  const metrics: PortfolioMetrics = {
    total_properties: availability.length,
    total_units: totalUnits,
    physical_occupancy_pct: round2(totalUnits === 0 ? 0 : (occupiedUnits / totalUnits) * 100),
    leased_pct: round2(totalUnits === 0 ? 0 : ((totalUnits - vacantUnrented) / totalUnits) * 100),
    available_units: availableUnits,
    vacant_unrented_exposure: vacantUnrentedExposure,
    expiring_60_days: expiring60Days,
    availability,
    lease_expiration_buckets: buckets,
    property_priority: propertyPriority,
  };

  const unitMarketRentRows = db
    .prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN market_rent IS NOT NULL THEN 1 ELSE 0 END) AS with_rent FROM residential_units"
    )
    .get() as { total: number; with_rent: number };

  const coverage = {
    market_rent_coverage:
      unitMarketRentRows.total === 0
        ? 0
        : round2((unitMarketRentRows.with_rent / unitMarketRentRows.total) * 100),
    lease_end_coverage: round2(
      leases.length === 0
        ? 0
        : (leases.filter((l) => l.lease_end_date !== null && l.lease_end_date !== "").length /
            leases.length) *
            100
    ),
  };

  const definitions: Record<string, string> = {
    total_units: "All residential units across the portfolio snapshot.",
    physical_occupancy_pct: "occupied / total_units, where occupied counts OCCUPIED units.",
    leased_pct: "(total_units - vacant_unrented) / total_units.",
    available_units: "notice_unrented + vacant_unrented.",
    vacant_unrented_exposure:
      "Sum of Market Rent for vacant_unrented units (immediately rentable, not pre-rented).",
    expiring_60_days: "Number of current leases ending within 60 days of as_of_date.",
  };

  return {
    as_of_date: options.asOfDate,
    month_year: options.monthYear,
    filters: {},
    metrics,
    definitions,
    coverage,
    data_quality: runDataQualityChecks(db, options),
  };
}
