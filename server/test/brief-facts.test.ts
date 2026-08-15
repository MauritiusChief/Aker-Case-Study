import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBriefFactsFromSummaries } from "../src/brief-facts.js";
import type { PortfolioSummary } from "../src/analysis/portfolio.js";
import type { RentGapSummary } from "../src/analysis/rent-gap.js";
import type { AvailabilitySummary } from "../src/types.js";

function availability(propertyCode: string, overrides: Partial<AvailabilitySummary>): AvailabilitySummary {
  return {
    property_code: propertyCode,
    property_name: propertyCode,
    avg_sq_ft: 700,
    avg_rent: 1_500,
    total_units: 10,
    occupied_no_notice: 8,
    vacant_rented: 0,
    vacant_unrented: 2,
    notice_rented: 0,
    notice_unrented: 0,
    avail: 2,
    model: 0,
    down: 0,
    admin: 0,
    occ_pct: 80,
    occ_w_non_rev_pct: 80,
    leased_pct: 80,
    occupied: 8,
    vacant: 2,
    ...overrides,
  };
}

test("BriefFacts deterministically selects leaders and strips quality identifiers", () => {
  const availabilityRows = [availability("P1", {}), availability("P2", { avail: 4, down: 1 })];
  const portfolio: PortfolioSummary = {
    as_of_date: "2026/02/25",
    month_year: "2026/02",
    filters: {},
    metrics: {
      total_properties: 2,
      total_units: 20,
      physical_occupancy_pct: 80,
      leased_pct: 85,
      available_units: 6,
      vacant_unrented_exposure: 5_000,
      expiring_60_days: 3,
      availability: availabilityRows,
      lease_expiration_buckets: {
        "0_30": 1,
        "31_60": 2,
        "61_90": 0,
        "91_180": 0,
        over_180: 0,
        expired: 0,
        missing: 0,
      },
      property_priority: [
        {
          property_code: "P1",
          property_name: "P1",
          total_units: 10,
          avail: 2,
          occ_pct: 80,
          leased_pct: 80,
          expiring_60: 3,
          vacant_unrented_exposure: 3_000,
        },
        {
          property_code: "P2",
          property_name: "P2",
          total_units: 10,
          avail: 4,
          occ_pct: 80,
          leased_pct: 90,
          expiring_60: 0,
          vacant_unrented_exposure: 2_000,
        },
      ],
    },
    definitions: {},
    coverage: { market_rent_coverage: 100 },
    data_quality: [
      {
        code: "MISSING_LEASE_END",
        severity: "warning",
        message: "Resident-specific message",
        property_code: "P2",
        resident_id: "secret-resident",
      },
    ],
  };
  const rentGap: RentGapSummary = {
    as_of_date: "2026/02/25",
    month_year: "2026/02",
    filters: {},
    metrics: {
      total_occupied_units: 16,
      comparable_units: 16,
      positive_loss_to_lease_count: 2,
      positive_loss_to_lease_amount: 500,
      premium_count: 0,
      total_loss_to_lease: 500,
      avg_loss_to_lease: 31.25,
    },
    by_property: [
      {
        key: "P1",
        label: "P1",
        occupied_units: 8,
        comparable_units: 8,
        avg_market_rent: 1_500,
        avg_base_rent: 1_450,
        avg_loss_to_lease: 50,
        total_loss_to_lease: 400,
        positive_count: 2,
        premium_count: 0,
      },
      {
        key: "P2",
        label: "P2",
        occupied_units: 8,
        comparable_units: 8,
        avg_market_rent: 1_500,
        avg_base_rent: 1_487.5,
        avg_loss_to_lease: 12.5,
        total_loss_to_lease: 100,
        positive_count: 1,
        premium_count: 0,
      },
    ],
    by_unit_type: [],
    definitions: {},
    coverage: { loss_to_lease_coverage: 100 },
    data_quality: [],
  };

  const facts = buildBriefFactsFromSummaries(portfolio, rentGap);
  assert.deepEqual(facts.scope.candidate_property_codes, ["P1", "P2"]);
  assert.deepEqual(facts.scope.portfolio_property_codes, ["P1", "P2"]);
  assert.equal(facts.properties.length, 2);
  assert.deepEqual(facts.candidates[0]?.selected_for, [
    "vacant_unrented_exposure",
    "lease_expirations_60",
    "positive_rent_gap",
  ]);
  assert.deepEqual(facts.candidates[1]?.selected_for, [
    "available_units",
    "down_units",
    "data_quality",
  ]);
  assert.equal(JSON.stringify(facts).includes("secret-resident"), false);
  assert.equal(JSON.stringify(facts).includes("Resident-specific message"), false);
});
