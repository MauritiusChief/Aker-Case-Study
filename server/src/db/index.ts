/** Walkthrough note: Owns the normalized SQLite snapshot schema and connection setup. */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH } from "../config.js";

// Unit status preserves MODEL, DOWN, and ADMIN cases that resident dates cannot
// represent; aggregate availability remains derived rather than stored.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS properties (
  code TEXT PRIMARY KEY,
  name TEXT
);

CREATE TABLE IF NOT EXISTS residential_units (
  unit_code    TEXT NOT NULL,
  property_code TEXT NOT NULL,
  type         TEXT,
  area         INTEGER,
  market_rent  REAL,
  resident_id  TEXT,
  status       TEXT NOT NULL DEFAULT 'OCCUPIED',
  PRIMARY KEY (unit_code, property_code),
  FOREIGN KEY (property_code) REFERENCES properties(code),
  FOREIGN KEY (resident_id) REFERENCES residents(id)
);

CREATE TABLE IF NOT EXISTS residents (
  id               TEXT PRIMARY KEY,
  name             TEXT,
  security_deposit REAL,
  other_deposit    REAL,
  balance          REAL,
  move_in_date     TEXT,
  lease_end_date   TEXT,
  move_out_date    TEXT,
  unit_code        TEXT,
  property_code    TEXT,
  FOREIGN KEY (unit_code, property_code) REFERENCES residential_units(unit_code, property_code)
);

CREATE TABLE IF NOT EXISTS rent_rolls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  month_year  TEXT,
  charge_code TEXT,
  amount      REAL,
  resident_id TEXT,
  FOREIGN KEY (resident_id) REFERENCES residents(id)
);

CREATE INDEX IF NOT EXISTS idx_rent_rolls_month_year ON rent_rolls(month_year);
CREATE INDEX IF NOT EXISTS idx_rent_rolls_resident_id ON rent_rolls(resident_id);
CREATE INDEX IF NOT EXISTS idx_units_property_code ON residential_units(property_code);
CREATE INDEX IF NOT EXISTS idx_residents_unit ON residents(unit_code, property_code);
`;

export function createSchema(db: Database.Database): void {
  db.exec(SCHEMA);
}

export function createConnection(dbPath: string = DB_PATH): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  return db;
}

export type AppDatabase = Database.Database;
