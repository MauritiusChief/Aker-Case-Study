import type { AppDatabase } from "../db/index.js";
import type { ParsedRentRollFile } from "./rent-roll.js";

function parseMonthYearArg(argv: string[], fallback: string): string {
  const flagIndex = argv.findIndex((a) => a === "--month-year" || a === "-m");
  if (flagIndex >= 0 && argv[flagIndex + 1]) {
    return argv[flagIndex + 1];
  }
  const eqMatch = argv
    .map((a) => a.match(/^--month-year=(.+)$/))
    .find((m) => m !== null);
  if (eqMatch) return eqMatch[1];
  return fallback;
}

export function seedDatabase(db: AppDatabase, files: ParsedRentRollFile[], monthYear: string): void {
  const insertUnit = db.prepare(`
    INSERT OR IGNORE INTO residential_units
      (unit_code, property_code, type, area, market_rent, resident_id)
    VALUES
      (@unit_code, @property_code, @type, @area, @market_rent, NULL)
  `);

  const updateUnitResident = db.prepare(`
    UPDATE residential_units SET resident_id = @resident_id
    WHERE unit_code = @unit_code AND property_code = @property_code
  `);

  const insertResident = db.prepare(`
    INSERT OR REPLACE INTO residents
      (id, name, security_deposit, other_deposit, balance,
       move_in_date, lease_end_date, move_out_date, unit_code, property_code)
    VALUES
      (@id, @name, @security_deposit, @other_deposit, @balance,
       @move_in_date, @lease_end_date, @move_out_date, @unit_code, @property_code)
  `);

  const insertRentRoll = db.prepare(`
    INSERT INTO rent_rolls (month_year, charge_code, amount, resident_id)
    VALUES (@month_year, @charge_code, @amount, @resident_id)
  `);

  const transaction = db.transaction((parsedFiles: ParsedRentRollFile[]) => {
    for (const file of parsedFiles) {
      for (const unit of file.units) {
        insertUnit.run(unit);
      }
    }

    for (const file of parsedFiles) {
      for (const resident of file.residents) {
        insertResident.run(resident);
      }
    }

    for (const file of parsedFiles) {
      for (const resident of file.futureResidents) {
        insertResident.run(resident);
      }
    }

    for (const file of parsedFiles) {
      for (const unit of file.units) {
        if (unit.resident_id !== null) {
          updateUnitResident.run({
            resident_id: unit.resident_id,
            unit_code: unit.unit_code,
            property_code: unit.property_code,
          });
        }
      }
    }

    for (const file of parsedFiles) {
      for (const rentRoll of file.rentRolls) {
        insertRentRoll.run({
          month_year: monthYear,
          charge_code: rentRoll.charge_code,
          amount: rentRoll.amount,
          resident_id: rentRoll.resident_id,
        });
      }
    }
  });

  transaction(files);
}
