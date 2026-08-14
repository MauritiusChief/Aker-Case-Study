import { Router } from "express";
import type { AppDatabase } from "../db/index.js";

export function availabilityRouter(db: AppDatabase): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const rows = db
      .prepare(
        `SELECT
           p.code AS property_code,
           p.name AS property_name,
           COUNT(u.unit_code) AS total_units,
           SUM(CASE WHEN u.resident_id IS NOT NULL THEN 1 ELSE 0 END) AS occupied,
           SUM(CASE WHEN u.resident_id IS NULL THEN 1 ELSE 0 END) AS vacant
         FROM properties p
         LEFT JOIN residential_units u ON u.property_code = p.code
         GROUP BY p.code, p.name
         ORDER BY p.code`
      )
      .all();

    res.json(rows);
  });

  return router;
}
