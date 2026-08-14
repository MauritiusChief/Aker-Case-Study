import { useEffect, useState } from "react";
import type { PortfolioSummary } from "../types";
import { fetchPortfolioSummary } from "../api/client";
import { KpiCard } from "../components/KpiCard";
import { AvailabilityChart } from "../components/AvailabilityChart";
import { PropertyPriorityTable } from "../components/PropertyPriorityTable";
import { LeaseExpirationBuckets } from "../components/LeaseExpirationBuckets";
import { DataQualityPanel } from "../components/DataQualityPanel";
import { TrendReadiness } from "../components/TrendReadiness";
import { formatCurrency, formatNumber, formatPercent, toDisplayDate } from "../lib/format";

export function PortfolioPage() {
  const [data, setData] = useState<PortfolioSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPortfolioSummary()
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return <div className="error-banner">Failed to load portfolio: {error}</div>;
  }

  if (!data) {
    return <div className="loading">Loading portfolio snapshot…</div>;
  }

  const { metrics, data_quality } = data;
  const qualityCount = data_quality.length;

  return (
    <div className="portfolio">
      <div className="page-header">
        <h1>Portfolio Overview</h1>
        <div className="as-of">
          <span className="as-of-label">Data as of</span>
          <span className="as-of-value">{toDisplayDate(data.as_of_date)}</span>
        </div>
      </div>

      <div className="meta-bar">
        <span>{formatNumber(metrics.total_properties)} properties</span>
        <span>{formatNumber(metrics.total_units)} units</span>
        <span>Month {data.month_year}</span>
        <span className={qualityCount > 0 ? "meta-flag" : ""}>
          {qualityCount} data quality {qualityCount === 1 ? "hint" : "hints"}
        </span>
      </div>

      <div className="kpi-grid">
        <KpiCard
          label="Total Units"
          value={formatNumber(metrics.total_units)}
        />
        <KpiCard
          label="Physical Occupancy"
          value={formatPercent(metrics.physical_occupancy_pct)}
        />
        <KpiCard
          label="Leased Percentage"
          value={formatPercent(metrics.leased_pct)}
        />
        <KpiCard label="Available Units" value={formatNumber(metrics.available_units)} />
        <KpiCard
          label="Vacant Unrented Exposure"
          value={formatCurrency(metrics.vacant_unrented_exposure)}
          info="Total Market Rent of vacant_unrented units: VACANT units with no future resident booked within the stale window. These are immediately rentable but not yet pre-rented."
        />
        <KpiCard
          label="Expiring in 60 Days"
          value={formatNumber(metrics.expiring_60_days)}
        />
      </div>

      <div className="two-col">
        <AvailabilityChart data={metrics.availability} />
        <LeaseExpirationBuckets buckets={metrics.lease_expiration_buckets} />
      </div>

      <PropertyPriorityTable rows={metrics.property_priority} />

      <DataQualityPanel issues={data_quality} />

      <TrendReadiness />
    </div>
  );
}
