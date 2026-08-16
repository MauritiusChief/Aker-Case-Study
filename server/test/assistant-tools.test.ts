import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createToolExecutor } from "../src/assistant-tools.js";
import type { BriefFacts } from "../src/assistant-types.js";
import { createSchema } from "../src/db/index.js";

const facts: BriefFacts = {
  as_of_date: "2026/02/25",
  month_year: "2026/02",
  scope: {
    kind: "candidate_and_portfolio_comparison",
    candidate_property_codes: ["P1"],
    portfolio_property_codes: ["P1"],
  },
  portfolio: {
    total_properties: 1,
    total_units: 1,
    physical_occupancy_pct: 100,
    leased_pct: 100,
    available_units: 0,
    vacant_unrented_exposure: 0,
    expiring_60_days: 0,
    net_loss_to_lease: 0,
    net_gain_to_lease: 100,
    loss_to_lease_unit_count: 0,
    gain_to_lease_unit_count: 1,
  },
  coverage: { market_rent_coverage: 100, loss_to_lease_coverage: 100 },
  data_quality: { error_count: 0, warning_count: 0, by_code: [] },
  properties: [],
  candidates: [],
  limitations: [],
};

test("assistant tools replace signed lease-gap fields with loss and gain pairs", () => {
  const db = new Database(":memory:");
  try {
    createSchema(db);
    db.prepare("INSERT INTO properties (code, name) VALUES (?, ?)").run("P1", "Property 1");
    db.prepare(
      `INSERT INTO residential_units
       (unit_code, property_code, type, market_rent, resident_id, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("101", "P1", "1B", 1700, null, "OCCUPIED");
    db.prepare(
      `INSERT INTO residents
       (id, name, balance, move_in_date, lease_end_date, unit_code, property_code)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("R1", "Resident", 0, "2025/01/01", "2027/01/01", "101", "P1");
    db.prepare(
      "UPDATE residential_units SET resident_id = ? WHERE unit_code = ? AND property_code = ?"
    ).run("R1", "101", "P1");
    db.prepare(
      `INSERT INTO rent_rolls (month_year, charge_code, amount, resident_id)
       VALUES (?, ?, ?, ?)`
    ).run("2026/02", "RENT", 1800, "R1");

    const execute = createToolExecutor(
      db,
      { asOfDate: "2026/02/25", staleDays: 30, monthYear: "2026/02" },
      facts,
      "portfolio"
    );
    const results = [
      execute("get_property_summary", JSON.stringify({ property_code: "P1" })),
      execute("get_portfolio_comparison", JSON.stringify({ property_codes: ["P1"] })),
      execute("get_lease_risk", JSON.stringify({ property_code: "P1" })),
      execute("get_rent_gap", JSON.stringify({ property_code: "P1" })),
    ];

    for (const result of results) {
      const serialized = JSON.stringify(result);
      assert.doesNotMatch(serialized, /"total_loss_to_lease":/);
      assert.doesNotMatch(serialized, /"avg_loss_to_lease":/);
      assert.doesNotMatch(serialized, /"positive_loss_to_lease_count":/);
      assert.doesNotMatch(serialized, /"premium_count":/);
      assert.match(serialized, /"net_gain_to_lease":100/);
      assert.match(serialized, /"net_loss_to_lease":0/);
    }
  } finally {
    db.close();
  }
});
