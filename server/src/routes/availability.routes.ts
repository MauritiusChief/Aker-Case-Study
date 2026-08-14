import { Router } from "express";
import type { AppDatabase } from "../db/index.js";
import type { AvailabilitySummary } from "../types.js";
import { AS_OF_DATE, BOOKING_STALE_DAYS } from "../config.js";

function parseMdY(value: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])));
}

function toYyyyMmDd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function bookingCutoff(asOf: string, staleDays: number): string {
  const parsed = parseMdY(asOf);
  if (!parsed) throw new Error(`Invalid AS_OF_DATE: ${asOf}`);
  return toYyyyMmDd(new Date(parsed.getTime() - staleDays * 86_400_000));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const MOVE_IN_YYYYMMDD =
  "substr(fr.move_in_date, 7, 4) || substr(fr.move_in_date, 1, 2) || substr(fr.move_in_date, 4, 2)";

export function availabilityRouter(db: AppDatabase): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const cutoff = bookingCutoff(AS_OF_DATE, BOOKING_STALE_DAYS);

    const rows = db
      .prepare(
        `SELECT
           p.code AS property_code,
           p.name AS property_name,
           ROUND(COALESCE(AVG(u.area), 0)) AS avg_sq_ft,
           ROUND(COALESCE(AVG(u.market_rent), 0)) AS avg_rent,
           COUNT(u.unit_code) AS total_units,
           SUM(CASE WHEN u.resident_id IS NOT NULL AND r.move_out_date IS NULL THEN 1 ELSE 0 END) AS occupied_no_notice,
           SUM(CASE WHEN u.unit_code IS NOT NULL AND u.resident_id IS NULL
                     AND EXISTS (
                       SELECT 1 FROM residents fr
                       WHERE fr.property_code = u.property_code
                         AND fr.unit_code = u.unit_code
                         AND CAST(${MOVE_IN_YYYYMMDD} AS INTEGER) >= @cutoff
                     ) THEN 1 ELSE 0 END) AS vacant_rented,
           SUM(CASE WHEN u.unit_code IS NOT NULL AND u.resident_id IS NULL
                     AND NOT EXISTS (
                       SELECT 1 FROM residents fr
                       WHERE fr.property_code = u.property_code
                         AND fr.unit_code = u.unit_code
                         AND CAST(${MOVE_IN_YYYYMMDD} AS INTEGER) >= @cutoff
                     ) THEN 1 ELSE 0 END) AS vacant_unrented,
           SUM(CASE WHEN u.resident_id IS NOT NULL AND r.move_out_date IS NOT NULL
                     AND EXISTS (
                       SELECT 1 FROM residents fr
                       WHERE fr.property_code = u.property_code
                         AND fr.unit_code = u.unit_code
                         AND fr.id <> u.resident_id
                         AND CAST(${MOVE_IN_YYYYMMDD} AS INTEGER) >= @cutoff
                     ) THEN 1 ELSE 0 END) AS notice_rented,
           SUM(CASE WHEN u.resident_id IS NOT NULL AND r.move_out_date IS NOT NULL
                     AND NOT EXISTS (
                       SELECT 1 FROM residents fr
                       WHERE fr.property_code = u.property_code
                         AND fr.unit_code = u.unit_code
                         AND fr.id <> u.resident_id
                         AND CAST(${MOVE_IN_YYYYMMDD} AS INTEGER) >= @cutoff
                     ) THEN 1 ELSE 0 END) AS notice_unrented
         FROM properties p
         LEFT JOIN residential_units u ON u.property_code = p.code
         LEFT JOIN residents r ON r.id = u.resident_id
         GROUP BY p.code, p.name
         ORDER BY p.code`
      )
      .all({ cutoff }) as Omit<AvailabilitySummary, "avail" | "model" | "down" | "admin" | "occ_pct" | "occ_w_non_rev_pct" | "leased_pct" | "occupied" | "vacant">[];

    const result: AvailabilitySummary[] = rows.map((row) => {
      const totalUnits = row.total_units;
      const occupiedNoNotice = row.occupied_no_notice;
      const noticeRented = row.notice_rented;
      const noticeUnrented = row.notice_unrented;
      const vacantRented = row.vacant_rented;
      const vacantUnrented = row.vacant_unrented;
      const occupied = occupiedNoNotice + noticeRented + noticeUnrented;
      const vacant = vacantRented + vacantUnrented;
      const avail = noticeUnrented + vacantUnrented;
      const pct = (numerator: number): number =>
        totalUnits === 0 ? 0 : (numerator / totalUnits) * 100;

      return {
        property_code: row.property_code,
        property_name: row.property_name,
        avg_sq_ft: row.avg_sq_ft,
        avg_rent: row.avg_rent,
        total_units: totalUnits,
        occupied_no_notice: occupiedNoNotice,
        vacant_rented: vacantRented,
        vacant_unrented: vacantUnrented,
        notice_rented: noticeRented,
        notice_unrented: noticeUnrented,
        avail,
        model: 0,
        down: 0,
        admin: 0,
        occ_pct: round2(pct(occupied)),
        occ_w_non_rev_pct: round2(pct(occupied)),
        leased_pct: round2(pct(totalUnits - vacantUnrented)),
        occupied,
        vacant,
      };
    });

    res.json(result);
  });

  return router;
}
