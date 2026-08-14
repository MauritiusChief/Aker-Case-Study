import type { PortfolioSummary } from "../types";

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
