/** Walkthrough note: Read-only unit facts addressed by the property/unit composite key. */
import { Router } from "express";
import type { AppDatabase } from "../db/index.js";
import type { ResidentialUnit } from "../types.js";

export function unitsRouter(db: AppDatabase): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const propertyCode = req.query.property_code as string | undefined;
    const rows = propertyCode
      ? (db
          .prepare(
            `SELECT unit_code, property_code, type, area, market_rent, resident_id, status
             FROM residential_units WHERE property_code = ? ORDER BY unit_code`
          )
          .all(propertyCode) as ResidentialUnit[])
      : (db
          .prepare(
            `SELECT unit_code, property_code, type, area, market_rent, resident_id, status
             FROM residential_units ORDER BY property_code, unit_code`
          )
          .all() as ResidentialUnit[]);
    res.json(rows);
  });

  router.get("/:unitCode", (req, res) => {
    const propertyCode = req.query.propertyCode as string | undefined;
    const row = propertyCode
      ? (db
          .prepare(
            `SELECT unit_code, property_code, type, area, market_rent, resident_id, status
             FROM residential_units WHERE unit_code = ? AND property_code = ?`
          )
          .get(req.params.unitCode, propertyCode) as ResidentialUnit | undefined)
      : undefined;

    if (propertyCode === undefined) {
      res
        .status(400)
        .json({ error: "propertyCode query parameter is required (composite key)" });
      return;
    }
    if (!row) {
      res.status(404).json({ error: "Unit not found" });
      return;
    }
    res.json(row);
  });

  return router;
}
