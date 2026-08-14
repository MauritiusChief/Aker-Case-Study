import { Router } from "express";
import type { AppDatabase } from "../db/index.js";
import { AS_OF_DATE, BOOKING_STALE_DAYS, DEFAULT_MONTH_YEAR } from "../config.js";
import {
  computeLeaseRiskSummary,
  LEASE_BUCKETS,
  type LeaseRiskFilters,
} from "../analysis/lease-risk.js";

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const num = Number(value);
  return Number.isNaN(num) ? undefined : num;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseBucket(value: unknown): LeaseRiskFilters["bucket"] {
  if (typeof value !== "string") return undefined;
  return (LEASE_BUCKETS as readonly string[]).includes(value)
    ? (value as LeaseRiskFilters["bucket"])
    : undefined;
}

export function leaseRiskRouter(db: AppDatabase): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const filters: LeaseRiskFilters = {
      property: typeof req.query.property === "string" ? req.query.property : undefined,
      bucket: parseBucket(req.query.bucket),
      unit_type: typeof req.query.unit_type === "string" ? req.query.unit_type : undefined,
      has_move_out: parseOptionalBoolean(req.query.has_move_out),
      has_positive_balance: parseOptionalBoolean(req.query.has_positive_balance),
      rent_gap_min: parseOptionalNumber(req.query.rent_gap_min),
      rent_gap_max: parseOptionalNumber(req.query.rent_gap_max),
    };

    const result = computeLeaseRiskSummary(
      db,
      {
        asOfDate: AS_OF_DATE,
        staleDays: BOOKING_STALE_DAYS,
        monthYear: DEFAULT_MONTH_YEAR,
      },
      filters
    );
    res.json(result);
  });

  return router;
}
