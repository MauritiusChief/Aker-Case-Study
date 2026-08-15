import type { AppDatabase } from "../db/index.js";
import type { AvailabilitySummary } from "../types.js";
import { addDays } from "../lib/dates.js";

export interface AvailabilityOptions {
  asOfDate: string;
  staleDays: number;
}

export function bookingCutoff(asOfDate: string, staleDays: number): string {
  return addDays(asOfDate, -staleDays);
}

type AvailabilityRow = Omit<
  AvailabilitySummary,
  "avail" | "occupancy_pct" | "occ_w_non_rev_pct" | "leased_pct" | "occupied" | "vacant"
>;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const BOOKED_VACANT_SQL = `EXISTS (
  SELECT 1 FROM residents fr
  WHERE fr.property_code = u.property_code
    AND fr.unit_code = u.unit_code
    AND fr.move_in_date IS NOT NULL
    AND fr.move_in_date <> ''
    AND fr.move_in_date >= @cutoff
)`;

export const BOOKED_OCCUPIED_SQL = `EXISTS (
  SELECT 1 FROM residents fr
  WHERE fr.property_code = u.property_code
    AND fr.unit_code = u.unit_code
    AND fr.id <> u.resident_id
    AND fr.move_in_date IS NOT NULL
    AND fr.move_in_date <> ''
    AND fr.move_in_date >= @cutoff
)`;

export function queryAvailabilitySummaries(
  db: AppDatabase,
  options: AvailabilityOptions
): AvailabilitySummary[] {
  const cutoff = bookingCutoff(options.asOfDate, options.staleDays);

  const rows = db
    .prepare(
      `SELECT
         p.code AS property_code,
         p.name AS property_name,
         ROUND(COALESCE(AVG(u.area), 0)) AS avg_sq_ft,
         ROUND(COALESCE(AVG(u.market_rent), 0)) AS avg_rent,
         COUNT(u.unit_code) AS total_units,
         SUM(CASE WHEN u.status = 'OCCUPIED' AND r.move_out_date IS NULL THEN 1 ELSE 0 END) AS occupied_no_notice,
         SUM(CASE WHEN u.status = 'VACANT' AND ${BOOKED_VACANT_SQL} THEN 1 ELSE 0 END) AS vacant_rented,
         SUM(CASE WHEN u.status = 'VACANT' AND NOT ${BOOKED_VACANT_SQL} THEN 1 ELSE 0 END) AS vacant_unrented,
         SUM(CASE WHEN u.status = 'OCCUPIED' AND r.move_out_date IS NOT NULL AND ${BOOKED_OCCUPIED_SQL} THEN 1 ELSE 0 END) AS notice_rented,
         SUM(CASE WHEN u.status = 'OCCUPIED' AND r.move_out_date IS NOT NULL AND NOT ${BOOKED_OCCUPIED_SQL} THEN 1 ELSE 0 END) AS notice_unrented,
         SUM(CASE WHEN u.status = 'MODEL' THEN 1 ELSE 0 END) AS model,
         SUM(CASE WHEN u.status = 'DOWN' THEN 1 ELSE 0 END) AS down,
         SUM(CASE WHEN u.status = 'ADMIN' THEN 1 ELSE 0 END) AS admin
       FROM properties p
       LEFT JOIN residential_units u ON u.property_code = p.code
       LEFT JOIN residents r ON r.id = u.resident_id
       GROUP BY p.code, p.name
       ORDER BY p.code`
    )
    .all({ cutoff }) as AvailabilityRow[];

  return rows.map((row) => {
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
      model: row.model,
      down: row.down,
      admin: row.admin,
      occupancy_pct: round2(pct(occupied)),
      occ_w_non_rev_pct: round2(pct(occupied + row.model + row.down + row.admin)),
      leased_pct: round2(pct(totalUnits - vacantUnrented)),
      occupied,
      vacant,
    };
  });
}
