import { Router } from "express";
import type { AppDatabase } from "../db/index.js";
import { AS_OF_DATE, BOOKING_STALE_DAYS, DEFAULT_MONTH_YEAR } from "../config.js";
import { computeRentGapSummary } from "../analysis/rent-gap.js";

export function rentGapRouter(db: AppDatabase): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const result = computeRentGapSummary(db, {
      asOfDate: AS_OF_DATE,
      staleDays: BOOKING_STALE_DAYS,
      monthYear: DEFAULT_MONTH_YEAR,
    });
    res.json(result);
  });

  return router;
}
