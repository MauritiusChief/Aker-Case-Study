import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLossToLease, applyLeaseRiskFilters } from "../src/analysis/lease-risk.js";
import type { LeaseRiskRow } from "../src/analysis/lease-risk.js";

test("computeLossToLease returns null when base rent is missing or zero", () => {
  assert.deepEqual(computeLossToLease(2000, null), { loss: null, pct: null });
  assert.deepEqual(computeLossToLease(2000, 0), { loss: null, pct: null });
  assert.deepEqual(computeLossToLease(null, 1800), { loss: null, pct: null });
});

test("computeLossToLease computes loss and percentage", () => {
  assert.deepEqual(computeLossToLease(2000, 1800), { loss: 200, pct: 11.11 });
  assert.deepEqual(computeLossToLease(1700, 1800), { loss: -100, pct: -5.56 });
});

function makeRow(overrides: Partial<LeaseRiskRow>): LeaseRiskRow {
  return {
    property_code: "P1",
    property_name: null,
    unit_code: "101",
    unit_type: "1B",
    resident_id: "r1",
    resident_name: null,
    lease_end_date: "2026/03/27",
    move_out_date: null,
    move_in_date: "2025/01/01",
    market_rent: 2000,
    scheduled_base_rent: 1800,
    loss_to_lease: 200,
    loss_to_lease_pct: 11.11,
    balance: 0,
    availability_status: "occupied_no_notice",
    bucket: "0_30",
    ...overrides,
  };
}

test("applyLeaseRiskFilters passes through unfiltered rows", () => {
  const rows = [makeRow({})];
  assert.equal(applyLeaseRiskFilters(rows, {}).length, 1);
});

test("applyLeaseRiskFilters filters by property, bucket, and unit_type", () => {
  const rows = [makeRow({}), makeRow({ property_code: "P2", unit_type: "2B", bucket: "31_60" })];
  assert.equal(applyLeaseRiskFilters(rows, { property: "P1" }).length, 1);
  assert.equal(applyLeaseRiskFilters(rows, { bucket: "31_60" }).length, 1);
  assert.equal(applyLeaseRiskFilters(rows, { unit_type: "2B" }).length, 1);
  assert.equal(applyLeaseRiskFilters(rows, { property: "P9" }).length, 0);
});

test("applyLeaseRiskFilters filters by move-out presence", () => {
  const rows = [makeRow({}), makeRow({ move_out_date: "2026/03/01" })];
  assert.equal(applyLeaseRiskFilters(rows, { has_move_out: true }).length, 1);
  assert.equal(applyLeaseRiskFilters(rows, { has_move_out: false }).length, 1);
});

test("applyLeaseRiskFilters filters by balance sign", () => {
  const rows = [makeRow({ balance: 100 }), makeRow({ balance: -50 })];
  assert.equal(applyLeaseRiskFilters(rows, { has_positive_balance: true }).length, 1);
  assert.equal(applyLeaseRiskFilters(rows, { has_positive_balance: false }).length, 1);
});

test("applyLeaseRiskFilters filters by rent gap range", () => {
  const rows = [makeRow({ loss_to_lease: 200 }), makeRow({ loss_to_lease: -100 })];
  assert.equal(applyLeaseRiskFilters(rows, { rent_gap_min: 0 }).length, 1);
  assert.equal(applyLeaseRiskFilters(rows, { rent_gap_max: 0 }).length, 1);
  assert.equal(applyLeaseRiskFilters(rows, { rent_gap_min: 0, rent_gap_max: 500 }).length, 1);
});
