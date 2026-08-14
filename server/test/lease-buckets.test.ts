import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketizeLeaseEnd } from "../src/analysis/lease-buckets.js";

const AS_OF = "2026/02/25";

test("bucketizeLeaseEnd maps 0..30 days to 0_30", () => {
  assert.equal(bucketizeLeaseEnd(AS_OF, "2026/02/25"), "0_30");
  assert.equal(bucketizeLeaseEnd(AS_OF, "2026/03/27"), "0_30");
});

test("bucketizeLeaseEnd maps 31..60 days to 31_60", () => {
  assert.equal(bucketizeLeaseEnd(AS_OF, "2026/03/28"), "31_60");
  assert.equal(bucketizeLeaseEnd(AS_OF, "2026/04/26"), "31_60");
});

test("bucketizeLeaseEnd maps 61..90 days to 61_90", () => {
  assert.equal(bucketizeLeaseEnd(AS_OF, "2026/04/27"), "61_90");
  assert.equal(bucketizeLeaseEnd(AS_OF, "2026/05/26"), "61_90");
});

test("bucketizeLeaseEnd maps 91..180 days to 91_180", () => {
  assert.equal(bucketizeLeaseEnd(AS_OF, "2026/05/27"), "91_180");
  assert.equal(bucketizeLeaseEnd(AS_OF, "2026/08/24"), "91_180");
});

test("bucketizeLeaseEnd maps beyond 180 days to over_180", () => {
  assert.equal(bucketizeLeaseEnd(AS_OF, "2026/08/25"), "over_180");
  assert.equal(bucketizeLeaseEnd(AS_OF, "2027/02/25"), "over_180");
});

test("bucketizeLeaseEnd marks pre-as_of dates as expired", () => {
  assert.equal(bucketizeLeaseEnd(AS_OF, "2026/02/24"), "expired");
  assert.equal(bucketizeLeaseEnd(AS_OF, "2025/01/01"), "expired");
});

test("bucketizeLeaseEnd marks null/empty/invalid dates as missing", () => {
  assert.equal(bucketizeLeaseEnd(AS_OF, null), "missing");
  assert.equal(bucketizeLeaseEnd(AS_OF, undefined), "missing");
  assert.equal(bucketizeLeaseEnd(AS_OF, ""), "missing");
  assert.equal(bucketizeLeaseEnd(AS_OF, "02/25/2026"), "missing");
  assert.equal(bucketizeLeaseEnd(AS_OF, "2026/02/30"), "missing");
});
