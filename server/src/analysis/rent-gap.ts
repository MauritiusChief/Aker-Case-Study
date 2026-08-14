import type { AppDatabase } from "../db/index.js";
import type { AvailabilityOptions } from "./availability.js";
import { queryLeaseRiskRows } from "./lease-risk.js";
import { runDataQualityChecks, type DataQualityIssue } from "./quality.js";

export interface RentGapGroup {
  key: string;
  label: string | null;
  occupied_units: number;
  comparable_units: number;
  avg_market_rent: number | null;
  avg_base_rent: number | null;
  avg_loss_to_lease: number | null;
  total_loss_to_lease: number | null;
  positive_count: number;
  premium_count: number;
}

export interface RentGapMetrics {
  total_occupied_units: number;
  comparable_units: number;
  positive_loss_to_lease_count: number;
  positive_loss_to_lease_amount: number;
  premium_count: number;
  total_loss_to_lease: number;
  avg_loss_to_lease: number | null;
}

export interface RentGapSummary {
  as_of_date: string;
  month_year: string;
  filters: Record<string, unknown>;
  metrics: RentGapMetrics;
  by_property: RentGapGroup[];
  by_unit_type: RentGapGroup[];
  definitions: Record<string, string>;
  coverage: Record<string, number>;
  data_quality: DataQualityIssue[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function buildGroups(
  rows: ReturnType<typeof queryLeaseRiskRows>,
  keyFn: (row: ReturnType<typeof queryLeaseRiskRows>[number]) => string,
  labelFn: (row: ReturnType<typeof queryLeaseRiskRows>[number]) => string | null
): RentGapGroup[] {
  const groups = new Map<
    string,
    {
      label: string | null;
      occupied: number;
      comparable: number;
      market: number[];
      base: number[];
      loss: number[];
      totalLoss: number;
      positive: number;
      premium: number;
    }
  >();

  for (const row of rows) {
    const key = keyFn(row);
    let group = groups.get(key);
    if (!group) {
      group = {
        label: labelFn(row),
        occupied: 0,
        comparable: 0,
        market: [],
        base: [],
        loss: [],
        totalLoss: 0,
        positive: 0,
        premium: 0,
      };
      groups.set(key, group);
    }
    group.occupied += 1;
    if (row.loss_to_lease !== null && row.market_rent !== null && row.scheduled_base_rent > 0) {
      group.comparable += 1;
      group.market.push(row.market_rent);
      group.base.push(row.scheduled_base_rent);
      group.loss.push(row.loss_to_lease);
      group.totalLoss += row.loss_to_lease;
      if (row.loss_to_lease > 0) group.positive += 1;
      if (row.loss_to_lease < 0) group.premium += 1;
    }
  }

  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      label: g.label,
      occupied_units: g.occupied,
      comparable_units: g.comparable,
      avg_market_rent: avg(g.market),
      avg_base_rent: avg(g.base),
      avg_loss_to_lease: avg(g.loss),
      total_loss_to_lease: g.comparable === 0 ? null : round2(g.totalLoss),
      positive_count: g.positive,
      premium_count: g.premium,
    }))
    .sort((a, b) => (b.total_loss_to_lease ?? 0) - (a.total_loss_to_lease ?? 0));
}

export function computeRentGapSummary(
  db: AppDatabase,
  options: AvailabilityOptions & { monthYear: string }
): RentGapSummary {
  const rows = queryLeaseRiskRows(db, options);

  const comparable = rows.filter(
    (r) => r.loss_to_lease !== null && r.market_rent !== null && r.scheduled_base_rent > 0
  );
  const losses = comparable.map((r) => r.loss_to_lease as number);
  const totalLossToLease = round2(comparable.reduce((sum, r) => sum + (r.loss_to_lease ?? 0), 0));
  const positive = comparable.filter((r) => (r.loss_to_lease ?? 0) > 0);
  const positiveAmount = round2(positive.reduce((sum, r) => sum + (r.loss_to_lease ?? 0), 0));
  const premium = comparable.filter((r) => (r.loss_to_lease ?? 0) < 0);

  const metrics: RentGapMetrics = {
    total_occupied_units: rows.length,
    comparable_units: comparable.length,
    positive_loss_to_lease_count: positive.length,
    positive_loss_to_lease_amount: positiveAmount,
    premium_count: premium.length,
    total_loss_to_lease: totalLossToLease,
    avg_loss_to_lease: avg(losses),
  };

  const coverage = {
    loss_to_lease_coverage:
      rows.length === 0 ? 0 : round2((comparable.length / rows.length) * 100),
  };

  const definitions: Record<string, string> = {
    comparable_units: "Occupied units with both a Market Rent and identifiable Base Rent.",
    loss_to_lease: "market_rent - scheduled_base_rent.",
    positive_loss_to_lease: "Units whose Market Rent exceeds Scheduled Base Rent.",
    premium: "Units whose Market Rent is below Scheduled Base Rent.",
  };

  return {
    as_of_date: options.asOfDate,
    month_year: options.monthYear,
    filters: {},
    metrics,
    by_property: buildGroups(rows, (r) => r.property_code, (r) => r.property_name),
    by_unit_type: buildGroups(rows, (r) => r.unit_type ?? "(unknown)", (r) => r.unit_type),
    definitions,
    coverage,
    data_quality: runDataQualityChecks(db, options),
  };
}
