/** Walkthrough note: Read-only resident facts and their normalized rent-roll charges. */
import { Router } from "express";
import type { AppDatabase } from "../db/index.js";
import type { Resident } from "../types.js";

export function residentsRouter(db: AppDatabase): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const propertyCode = req.query.property_code as string | undefined;
    const rows = propertyCode
      ? (db
          .prepare(
            `SELECT id, name, security_deposit, other_deposit, balance,
                    move_in_date, lease_end_date, move_out_date, unit_code, property_code
             FROM residents WHERE property_code = ? ORDER BY id`
          )
          .all(propertyCode) as Resident[])
      : (db
          .prepare(
            `SELECT id, name, security_deposit, other_deposit, balance,
                    move_in_date, lease_end_date, move_out_date, unit_code, property_code
             FROM residents ORDER BY id`
          )
          .all() as Resident[]);
    res.json(rows);
  });

  router.get("/:id", (req, res) => {
    const row = db
      .prepare(
        `SELECT id, name, security_deposit, other_deposit, balance,
                move_in_date, lease_end_date, move_out_date, unit_code, property_code
         FROM residents WHERE id = ?`
      )
      .get(req.params.id) as Resident | undefined;
    if (!row) {
      res.status(404).json({ error: "Resident not found" });
      return;
    }
    res.json(row);
  });

  router.get("/:id/rent-rolls", (req, res) => {
    const rows = db
      .prepare(
        `SELECT id, month_year, charge_code, amount, resident_id
         FROM rent_rolls WHERE resident_id = ? ORDER BY id`
      )
      .all(req.params.id);
    res.json(rows);
  });

  return router;
}
