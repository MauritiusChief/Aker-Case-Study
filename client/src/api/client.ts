import type {
  LeaseRiskSummary,
  PortfolioSummary,
  PropertySummary,
  RentGapSummary,
} from "../types";

const API_BASE = "/api";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function fetchPortfolioSummary(): Promise<PortfolioSummary> {
  return getJson<PortfolioSummary>("/portfolio/summary");
}

export interface LeaseRiskQuery {
  property?: string;
  bucket?: string;
  unit_type?: string;
  has_move_out?: boolean;
  has_positive_balance?: boolean;
  rent_gap_min?: number;
  rent_gap_max?: number;
}

function toQueryString(query: LeaseRiskQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function fetchLeaseRisks(query: LeaseRiskQuery = {}): Promise<LeaseRiskSummary> {
  return getJson<LeaseRiskSummary>(`/lease-risks${toQueryString(query)}`);
}

export function fetchRentGap(): Promise<RentGapSummary> {
  return getJson<RentGapSummary>("/rent-gap");
}

export function fetchPropertySummary(propertyCode: string): Promise<PropertySummary> {
  return getJson<PropertySummary>(`/properties/${propertyCode}/summary`);
}
