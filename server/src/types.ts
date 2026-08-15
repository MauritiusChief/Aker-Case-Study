export interface Property {
  code: string;
  name: string | null;
}

export type UnitStatus = "OCCUPIED" | "VACANT" | "MODEL" | "DOWN" | "ADMIN";

export interface ResidentialUnit {
  unit_code: string;
  property_code: string;
  type: string | null;
  area: number | null;
  market_rent: number | null;
  resident_id: string | null;
  status: UnitStatus;
}

export interface Resident {
  id: string;
  name: string | null;
  security_deposit: number | null;
  other_deposit: number | null;
  balance: number | null;
  move_in_date: string | null;
  lease_end_date: string | null;
  move_out_date: string | null;
  unit_code: string | null;
  property_code: string | null;
}

export interface RentRoll {
  id: number;
  month_year: string;
  charge_code: string | null;
  amount: number | null;
  resident_id: string | null;
}

export interface AvailabilitySummary {
  property_code: string;
  property_name: string | null;
  avg_sq_ft: number | null;
  avg_rent: number | null;
  total_units: number;
  occupied_no_notice: number;
  vacant_rented: number;
  vacant_unrented: number;
  notice_rented: number;
  notice_unrented: number;
  avail: number;
  model: number;
  down: number;
  admin: number;
  occupancy_pct: number;
  occ_w_non_rev_pct: number;
  leased_pct: number;
  occupied: number;
  vacant: number;
}
