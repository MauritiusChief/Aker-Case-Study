/** Walkthrough note: Read-only endpoint for the canonical derived availability summaries. */
import { Router } from "express";
import type { AppDatabase } from "../db/index.js";
import { AS_OF_DATE, BOOKING_STALE_DAYS } from "../config.js";
import { queryAvailabilitySummaries } from "../analysis/availability.js";

export function availabilityRouter(db: AppDatabase): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const result = queryAvailabilitySummaries(db, {
      asOfDate: AS_OF_DATE,
      staleDays: BOOKING_STALE_DAYS,
    });
    res.json(result);
  });

  return router;
}
