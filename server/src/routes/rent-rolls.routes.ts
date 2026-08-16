/** Walkthrough note: Read-only access to normalized monthly resident charge rows. */
import { Router } from "express";
import type { AppDatabase } from "../db/index.js";
import type { RentRoll } from "../types.js";

export function rentRollsRouter(db: AppDatabase): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const monthYear = req.query.month_year as string | undefined;
    const propertyCode = req.query.property_code as string | undefined;
    const residentId = req.query.resident_id as string | undefined;

    const rows = db
      .prepare(
        `SELECT rr.id, rr.month_year, rr.charge_code, rr.amount, rr.resident_id
         FROM rent_rolls rr
         JOIN residents r ON r.id = rr.resident_id
         WHERE (? IS NULL OR rr.month_year = ?)
           AND (? IS NULL OR rr.resident_id = ?)
           AND (? IS NULL OR r.property_code = ?)
         ORDER BY rr.id`
      )
      .all(
        monthYear ?? null,
        monthYear ?? null,
        residentId ?? null,
        residentId ?? null,
        propertyCode ?? null,
        propertyCode ?? null
      ) as RentRoll[];

    res.json(rows);
  });

  router.get("/:id", (req, res) => {
    const row = db
      .prepare(
        `SELECT id, month_year, charge_code, amount, resident_id
         FROM rent_rolls WHERE id = ?`
      )
      .get(req.params.id) as RentRoll | undefined;
    if (!row) {
      res.status(404).json({ error: "Rent roll entry not found" });
      return;
    }
    res.json(row);
  });

  return router;
}
