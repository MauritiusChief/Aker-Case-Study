/** Walkthrough note: Serves the composed portfolio dashboard snapshot. */
import { Router } from "express";
import type { AppDatabase } from "../db/index.js";
import { AS_OF_DATE, BOOKING_STALE_DAYS, DEFAULT_MONTH_YEAR } from "../config.js";
import { computePortfolioSummary } from "../analysis/portfolio.js";

export function portfolioRouter(db: AppDatabase): Router {
  const router = Router();

  router.get("/summary", (_req, res) => {
    const result = computePortfolioSummary(db, {
      asOfDate: AS_OF_DATE,
      staleDays: BOOKING_STALE_DAYS,
      monthYear: DEFAULT_MONTH_YEAR,
    });
    res.json(result);
  });

  return router;
}
