import type { AppDatabase } from "./db/index.js";
import type { AvailabilityOptions } from "./analysis/availability.js";
import {
  computePortfolioSummary,
  type PortfolioSummary,
  type PropertyPriorityRow,
} from "./analysis/portfolio.js";
import { computeRentGapSummary, type RentGapSummary } from "./analysis/rent-gap.js";
import type {
  BriefCandidate,
  BriefFacts,
  CandidateSignal,
  QualityFacts,
} from "./assistant-types.js";
import type { DataQualityIssue } from "./analysis/quality.js";

const MAX_CANDIDATES = 6;

export function summarizeDataQuality(issues: DataQualityIssue[]): QualityFacts {
  const counts = new Map<string, { severity: "error" | "warning"; count: number }>();
  for (const issue of issues) {
    const key = `${issue.severity}:${issue.code}`;
    const current = counts.get(key);
    counts.set(key, { severity: issue.severity, count: (current?.count ?? 0) + 1 });
  }
  return {
    error_count: issues.filter((issue) => issue.severity === "error").length,
    warning_count: issues.filter((issue) => issue.severity === "warning").length,
    by_code: [...counts.entries()]
      .map(([key, value]) => ({ code: key.split(":")[1] ?? key, ...value }))
      .sort((a, b) => a.severity.localeCompare(b.severity) || a.code.localeCompare(b.code)),
  };
}

function addLeader(
  selected: Map<string, CandidateSignal[]>,
  signal: CandidateSignal,
  rows: PropertyPriorityRow[],
  value: (row: PropertyPriorityRow) => number
): void {
  const leader = [...rows].sort(
    (a, b) => value(b) - value(a) || a.property_code.localeCompare(b.property_code)
  )[0];
  if (!leader || value(leader) <= 0) return;
  const reasons = selected.get(leader.property_code) ?? [];
  reasons.push(signal);
  selected.set(leader.property_code, reasons);
}

export function buildBriefFactsFromSummaries(
  portfolio: PortfolioSummary,
  rentGap: RentGapSummary
): BriefFacts {
  const priorityRows = portfolio.metrics.property_priority;
  const selected = new Map<string, CandidateSignal[]>();
  addLeader(selected, "vacant_unrented_exposure", priorityRows, (row) => row.vacant_unrented_exposure);
  addLeader(selected, "available_units", priorityRows, (row) => row.avail);
  addLeader(selected, "lease_expirations_60", priorityRows, (row) => row.expiring_60);

  const rentByProperty = new Map(rentGap.by_property.map((row) => [row.key, row]));
  addLeader(selected, "positive_rent_gap", priorityRows, (row) =>
    Math.max(rentByProperty.get(row.property_code)?.total_loss_to_lease ?? 0, 0)
  );

  const availabilityByProperty = new Map(
    portfolio.metrics.availability.map((row) => [row.property_code, row])
  );
  addLeader(selected, "down_units", priorityRows, (row) =>
    availabilityByProperty.get(row.property_code)?.down ?? 0
  );
  addLeader(selected, "notice_unrented", priorityRows, (row) =>
    availabilityByProperty.get(row.property_code)?.notice_unrented ?? 0
  );

  const qualityCount = new Map<string, number>();
  for (const issue of portfolio.data_quality) {
    if (issue.property_code) {
      qualityCount.set(issue.property_code, (qualityCount.get(issue.property_code) ?? 0) + 1);
    }
  }
  addLeader(selected, "data_quality", priorityRows, (row) => qualityCount.get(row.property_code) ?? 0);

  const selectedEntries = [...selected.entries()].slice(0, MAX_CANDIDATES);
  const priorityByProperty = new Map(priorityRows.map((row) => [row.property_code, row]));
  const toPropertyFacts = (
    row: PropertyPriorityRow,
    selectedFor: CandidateSignal[]
  ): BriefCandidate => {
    const propertyCode = row.property_code;
    const availability = availabilityByProperty.get(propertyCode);
    const rent = rentByProperty.get(propertyCode);
    const signals: BriefCandidate["signals"] = {};
    const signalValues: Record<CandidateSignal, number> = {
      vacant_unrented_exposure: row.vacant_unrented_exposure,
      available_units: row.avail,
      lease_expirations_60: row.expiring_60,
      positive_rent_gap: Math.max(rent?.total_loss_to_lease ?? 0, 0),
      down_units: availability?.down ?? 0,
      notice_unrented: availability?.notice_unrented ?? 0,
      data_quality: qualityCount.get(propertyCode) ?? 0,
    };
    for (const [signal, value] of Object.entries(signalValues) as [CandidateSignal, number][]) {
      if (value > 0) signals[signal] = value;
    }
    return {
      property_code: propertyCode,
      property_name: row.property_name,
      selected_for: selectedFor,
      signals,
      metrics: {
        total_units: row.total_units,
        available_units: row.avail,
        vacant_unrented: availability?.vacant_unrented ?? 0,
        notice_unrented: availability?.notice_unrented ?? 0,
        down_units: availability?.down ?? 0,
        occupancy_pct: row.occ_pct,
        leased_pct: row.leased_pct,
        vacant_unrented_exposure: row.vacant_unrented_exposure,
        expiring_60: row.expiring_60,
        total_loss_to_lease: rent?.total_loss_to_lease ?? null,
        comparable_units: rent?.comparable_units ?? 0,
      },
    };
  };
  const properties = priorityRows.map((row) =>
    toPropertyFacts(row, selected.get(row.property_code) ?? [])
  );
  const candidates = selectedEntries.map(([propertyCode, selectedFor]) => {
    const row = priorityByProperty.get(propertyCode);
    if (!row) throw new Error(`Missing priority row for ${propertyCode}`);
    return toPropertyFacts(row, selectedFor);
  });

  return {
    as_of_date: portfolio.as_of_date,
    month_year: portfolio.month_year,
    scope: {
      kind: "candidate_and_portfolio_comparison",
      candidate_property_codes: candidates.map((candidate) => candidate.property_code),
      portfolio_property_codes: priorityRows.map((row) => row.property_code),
    },
    portfolio: {
      total_properties: portfolio.metrics.total_properties,
      total_units: portfolio.metrics.total_units,
      physical_occupancy_pct: portfolio.metrics.physical_occupancy_pct,
      leased_pct: portfolio.metrics.leased_pct,
      available_units: portfolio.metrics.available_units,
      vacant_unrented_exposure: portfolio.metrics.vacant_unrented_exposure,
      expiring_60_days: portfolio.metrics.expiring_60_days,
      total_loss_to_lease: rentGap.metrics.total_loss_to_lease,
      positive_loss_to_lease_count: rentGap.metrics.positive_loss_to_lease_count,
    },
    coverage: { ...portfolio.coverage, ...rentGap.coverage },
    data_quality: summarizeDataQuality(portfolio.data_quality),
    properties,
    candidates,
    limitations: [
      "The source is a single portfolio snapshot; historical change is unavailable.",
      "Balance is exposure and must not be characterized as delinquency.",
      "Core KPIs are deterministic server calculations; the model only investigates and explains them.",
    ],
  };
}

export function buildBriefFacts(
  db: AppDatabase,
  options: AvailabilityOptions & { monthYear: string }
): BriefFacts {
  return buildBriefFactsFromSummaries(
    computePortfolioSummary(db, options),
    computeRentGapSummary(db, options)
  );
}
