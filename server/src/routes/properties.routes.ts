import { Router } from "express";
import type { AppDatabase } from "../db/index.js";
import type { Property } from "../types.js";
import { AS_OF_DATE, BOOKING_STALE_DAYS, DEFAULT_MONTH_YEAR } from "../config.js";
import { computePropertySummary } from "../analysis/property-summary.js";

export function propertiesRouter(db: AppDatabase): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const rows = db
      .prepare("SELECT code, name FROM properties ORDER BY code")
      .all() as Property[];
    res.json(rows);
  });

  router.get("/:code", (req, res) => {
    const row = db
      .prepare("SELECT code, name FROM properties WHERE code = ?")
      .get(req.params.code) as Property | undefined;
    if (!row) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    res.json(row);
  });

  router.get("/:code/units", (req, res) => {
    const rows = db
      .prepare(
        `SELECT unit_code, property_code, type, area, market_rent, resident_id, status
         FROM residential_units WHERE property_code = ? ORDER BY unit_code`
      )
      .all(req.params.code);
    res.json(rows);
  });

  router.get("/:code/summary", (req, res) => {
    const summary = computePropertySummary(
      db,
      {
        asOfDate: AS_OF_DATE,
        staleDays: BOOKING_STALE_DAYS,
        monthYear: DEFAULT_MONTH_YEAR,
      },
      req.params.code
    );
    if (!summary) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    res.json(summary);
  });

  return router;
}
