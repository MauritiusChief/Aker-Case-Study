export interface Property {
  code: string;
  name: string | null;
}

export interface ResidentialUnit {
  unit_code: string;
  property_code: string;
  type: string | null;
  area: number | null;
  market_rent: number | null;
  resident_id: string | null;
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
