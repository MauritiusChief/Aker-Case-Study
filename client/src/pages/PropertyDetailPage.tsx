/** Walkthrough note: Property drill-down for all availability states, leases, and charges. */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { PropertySummary } from "../types";
import { fetchPropertySummary } from "../api/client";
import { DataQualityPanel } from "../components/DataQualityPanel";
import { LeaseExpirationBuckets } from "../components/LeaseExpirationBuckets";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  presentLeaseGap,
  toDisplayDate,
} from "../lib/format";

const AVAILABILITY_FIELDS: { key: string; label: string }[] = [
  { key: "occupied_no_notice", label: "Occupied (no notice)" },
  { key: "notice_rented", label: "Notice (re-rented)" },
  { key: "notice_unrented", label: "Notice (unrented)" },
  { key: "vacant_rented", label: "Vacant (rented)" },
  { key: "vacant_unrented", label: "Vacant (unrented)" },
  { key: "model", label: "Model" },
  { key: "down", label: "Down" },
  { key: "admin", label: "Admin" },
];

export function PropertyDetailPage() {
  const { propertyCode } = useParams<{ propertyCode: string }>();
  const [data, setData] = useState<PropertySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyCode) return;
    fetchPropertySummary(propertyCode)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [propertyCode]);

  if (error) {
    return <div className="error-banner">Failed to load property: {error}</div>;
  }

  if (!data) {
    return <div className="loading">Loading property…</div>;
  }

  const { metrics, availability, charge_codes } = data;
  const totalCharge = charge_codes.reduce((sum, c) => sum + c.amount, 0);
  const totalLeaseGap = presentLeaseGap(metrics.total_loss_to_lease, "Net");
  const averageLeaseGap = metrics.avg_loss_to_lease === null
    ? null
    : presentLeaseGap(metrics.avg_loss_to_lease, "Average");

  return (
    <div className="property-detail">
      <div className="page-header">
        <div>
          <Link to="/portfolio" className="row-link">
            ← Portfolio
          </Link>
          <h1>{data.property.name ?? data.property.code}</h1>
          <span className="card-subtitle">{data.property.code}</span>
        </div>
        <div className="as-of">
          <span className="as-of-label">Data as of</span>
          <span className="as-of-value">{toDisplayDate(data.as_of_date)}</span>
        </div>
      </div>

      <div className="kpi-grid kpi-grid-6">
        <div className="kpi-card">
          <div className="kpi-label">Total Units</div>
          <div className="kpi-value">{formatNumber(metrics.total_units)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Physical Occupancy</div>
          <div className="kpi-value">{formatPercent(metrics.occupancy_pct)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Leased %</div>
          <div className="kpi-value">{formatPercent(metrics.leased_pct)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Available Units</div>
          <div className="kpi-value">{formatNumber(metrics.avail)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Expiring in 60d</div>
          <div className="kpi-value">{formatNumber(metrics.expiring_60)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Vacant Unrented Exposure</div>
          <div className="kpi-value">{formatCurrency(metrics.vacant_unrented_exposure)}</div>
        </div>
      </div>

      <div className="two-col">
        <div className="chart-card">
          <div className="card-header">
            <h3>Availability Breakdown</h3>
          </div>
          {availability ? (
            <ul className="bucket-list">
              {AVAILABILITY_FIELDS.map((field) => {
                const value = (availability as unknown as Record<string, number>)[field.key] ?? 0;
                return (
                  <li key={field.key} className="bucket-row">
                    <span className="bucket-label">{field.label}</span>
                    <span className="bucket-bar-track">
                      <span
                        className="bucket-bar"
                        style={{ width: `${(value / Math.max(1, metrics.total_units)) * 100}%` }}
                      />
                    </span>
                    <span className="bucket-value">{formatNumber(value)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>No availability data.</p>
          )}
        </div>

        <LeaseExpirationBuckets buckets={data.lease_expiration_buckets} />
      </div>

      <div className="two-col">
        <div className="chart-card">
          <div className="card-header">
            <h3>Rent Gap</h3>
          </div>
          <div className="kpi-grid kpi-grid-3">
            <div className="kpi-card">
              <div className="kpi-label">Total Base Rent</div>
              <div className="kpi-value">{formatCurrency(metrics.total_base_rent)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">{totalLeaseGap.label}</div>
              <div className="kpi-value">{formatCurrency(totalLeaseGap.amount)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">{averageLeaseGap?.label ?? "Average Rent Gap"}</div>
              <div className="kpi-value">
                {averageLeaseGap ? formatCurrency(averageLeaseGap.amount) : "—"}
              </div>
            </div>
          </div>
          <p className="card-subtitle" style={{ marginTop: 8 }}>
            {formatNumber(metrics.comparable_units)} comparable units ·{" "}
            {formatNumber(metrics.positive_loss_to_lease_count)} Loss-to-Lease units ·{" "}
            {formatNumber(metrics.premium_count)} Gain-to-Lease units · coverage{" "}
            {formatPercent(data.coverage.loss_to_lease_coverage)}
          </p>
        </div>

        <div className="chart-card">
          <div className="card-header">
            <h3>Charge Code Composition</h3>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Category</th>
                  <th className="num">Amount</th>
                  <th className="num">Residents</th>
                  <th className="num">Share</th>
                </tr>
              </thead>
              <tbody>
                {charge_codes.map((row) => (
                  <tr key={row.charge_code}>
                    <td>{row.charge_code}</td>
                    <td>{row.category === "base_rent" ? "Base rent" : "Other"}</td>
                    <td className="num">{formatCurrency(row.amount)}</td>
                    <td className="num">{formatNumber(row.resident_count)}</td>
                    <td className="num">
                      {totalCharge > 0 ? formatPercent((row.amount / totalCharge) * 100, 1) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <DataQualityPanel issues={data.data_quality} />

      <div className="property-actions">
        <Link to={`/lease-risk?property=${propertyCode}`} className="btn btn-primary">
          View Lease Risk for this property
        </Link>
      </div>
    </div>
  );
}
