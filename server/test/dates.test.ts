import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  daysBetween,
  formatIsoDate,
  isIsoDate,
  parseIsoDate,
  toMonthYear,
} from "../src/lib/dates.js";

test("isIsoDate accepts canonical YYYY/MM/DD only", () => {
  assert.equal(isIsoDate("2026/02/25"), true);
  assert.equal(isIsoDate("2026/12/31"), true);
  assert.equal(isIsoDate("02/25/2026"), false);
  assert.equal(isIsoDate("2026-02-25"), false);
  assert.equal(isIsoDate("2026/2/5"), false);
  assert.equal(isIsoDate("2026/13/01"), false);
  assert.equal(isIsoDate("2026/02/30"), false);
  assert.equal(isIsoDate("2026/00/10"), false);
  assert.equal(isIsoDate(""), false);
  assert.equal(isIsoDate(null), false);
  assert.equal(isIsoDate(undefined), false);
});

test("parseIsoDate returns a UTC date and rejects invalid input", () => {
  const date = parseIsoDate("2026/02/25");
  assert.ok(date);
  assert.equal(date.getUTCFullYear(), 2026);
  assert.equal(date.getUTCMonth(), 1);
  assert.equal(date.getUTCDate(), 25);
  assert.equal(parseIsoDate("2026/02/30"), null);
  assert.equal(parseIsoDate("bad"), null);
});

test("formatIsoDate round-trips canonical values", () => {
  const date = parseIsoDate("2026/02/05");
  assert.ok(date);
  assert.equal(formatIsoDate(date), "2026/02/05");
});

test("addDays crosses month and year boundaries", () => {
  assert.equal(addDays("2026/02/25", 3), "2026/02/28");
  assert.equal(addDays("2026/02/25", 4), "2026/03/01");
  assert.equal(addDays("2026/02/25", 30), "2026/03/27");
  assert.equal(addDays("2026/12/31", 1), "2027/01/01");
  assert.equal(addDays("2026/03/01", -1), "2026/02/28");
});

test("daysBetween computes exact day deltas", () => {
  assert.equal(daysBetween("2026/02/25", "2026/02/25"), 0);
  assert.equal(daysBetween("2026/02/25", "2026/03/27"), 30);
  assert.equal(daysBetween("2026/02/25", "2026/02/24"), -1);
  assert.throws(() => daysBetween("bad", "2026/02/25"));
});

test("toMonthYear derives YYYY/MM", () => {
  assert.equal(toMonthYear("2026/02/25"), "2026/02");
  assert.equal(toMonthYear("2026/12/01"), "2026/12");
  assert.equal(toMonthYear("not a date"), null);
});
