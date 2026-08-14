import { createConnection, createSchema } from "../db/index.js";
import { AS_OF_DATE, BOOKING_STALE_DAYS, DEFAULT_MONTH_YEAR, DB_PATH } from "../config.js";
import { readRentRollFiles } from "./rent-roll.js";
import { readUnitAvailabilityFiles } from "./unit-availability.js";
import { seedDatabase } from "./populate.js";
import { runDataQualityChecks } from "../analysis/quality.js";

function main(): void {
  const monthYear = parseMonthYearArg(process.argv.slice(2), DEFAULT_MONTH_YEAR);

  console.log(`Opening database: ${DB_PATH}`);
  const db = createConnection();

  console.log(`Clearing existing data...`);
  db.pragma("foreign_keys = OFF");
  db.exec(`
    DROP TABLE IF EXISTS rent_rolls;
    DROP TABLE IF EXISTS residential_units;
    DROP TABLE IF EXISTS residents;
    DROP TABLE IF EXISTS properties;
  `);
  db.pragma("foreign_keys = ON");
  createSchema(db);

  console.log(`Importing properties from unit availability...`);
  const properties = readUnitAvailabilityFiles();
  const insertProperty = db.prepare(
    "INSERT INTO properties (code, name) VALUES (@code, @name)"
  );
  const insertProperties = db.transaction(() => {
    for (const property of properties) {
      insertProperty.run(property);
    }
  });
  insertProperties();
  console.log(`Imported ${properties.length} properties.`);

  console.log(`Importing rent roll data (month_year=${monthYear})...`);
  const rentRollFiles = readRentRollFiles();
  seedDatabase(db, rentRollFiles.map((f) => f.parsed), monthYear);

  const unitCount = db.prepare("SELECT COUNT(*) AS c FROM residential_units").get() as {
    c: number;
  };
  const residentCount = db.prepare("SELECT COUNT(*) AS c FROM residents").get() as {
    c: number;
  };
  const rentRollCount = db.prepare("SELECT COUNT(*) AS c FROM rent_rolls").get() as {
    c: number;
  };

  console.log(
    `Done. units=${unitCount.c}, residents=${residentCount.c}, rent_rolls=${rentRollCount.c}`
  );

  console.log(`Running data quality report...`);
  const issues = runDataQualityChecks(db, {
    asOfDate: AS_OF_DATE,
    staleDays: BOOKING_STALE_DAYS,
  });
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  console.log(
    `Data quality: ${errorCount} error(s), ${warningCount} warning(s)`
  );
  for (const issue of issues) {
    const scope = [
      issue.property_code,
      issue.unit_code,
      issue.resident_id,
    ]
      .filter(Boolean)
      .map((v) => String(v))
      .join(" / ");
    console.log(
      `  [${issue.severity.toUpperCase()}] ${issue.code}${scope ? ` (${scope})` : ""}: ${issue.message}`
    );
  }

  db.close();
}

function parseMonthYearArg(argv: string[], fallback: string): string {
  const flagIndex = argv.findIndex((a) => a === "--month-year" || a === "-m");
  if (flagIndex >= 0 && argv[flagIndex + 1]) return argv[flagIndex + 1];
  const eqMatch = argv
    .map((a) => a.match(/^--month-year=(.+)$/))
    .find((m) => m !== null);
  if (eqMatch) return eqMatch[1];
  return fallback;
}

main();
