export type QualitySeverity = "error" | "warning";

export interface DataQualityIssue {
  code: string;
  severity: QualitySeverity;
  message: string;
  property_code?: string;
  unit_code?: string;
  resident_id?: string;
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
  occ_pct: number;
  occ_w_non_rev_pct: number;
  leased_pct: number;
  occupied: number;
  vacant: number;
}

export interface LeaseExpirationBuckets {
  "0_30": number;
  "31_60": number;
  "61_90": number;
  "91_180": number;
  over_180: number;
  expired: number;
  missing: number;
}

export interface PropertyPriorityRow {
  property_code: string;
  property_name: string | null;
  total_units: number;
  avail: number;
  occ_pct: number;
  leased_pct: number;
  expiring_60: number;
  vacant_unrented_exposure: number;
}

export interface PortfolioMetrics {
  total_properties: number;
  total_units: number;
  physical_occupancy_pct: number;
  leased_pct: number;
  available_units: number;
  vacant_unrented_exposure: number;
  expiring_60_days: number;
  availability: AvailabilitySummary[];
  lease_expiration_buckets: LeaseExpirationBuckets;
  property_priority: PropertyPriorityRow[];
}

export interface PortfolioSummary {
  as_of_date: string;
  month_year: string;
  filters: Record<string, unknown>;
  metrics: PortfolioMetrics;
  definitions: Record<string, string>;
  coverage: Record<string, number>;
  data_quality: DataQualityIssue[];
}
