import { Router } from "express";
import type { AppDatabase } from "../db/index.js";
import type { Property } from "../types.js";

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
        `SELECT unit_code, property_code, type, area, market_rent, resident_id
         FROM residential_units WHERE property_code = ? ORDER BY unit_code`
      )
      .all(req.params.code);
    res.json(rows);
  });

  return router;
}
