/** Walkthrough note: Filterable, paged lease cohort and rent-gap investigation workspace. */
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { LeaseBucket, LeaseRiskSummary } from "../types";
import { fetchLeaseRisks, type LeaseRiskQuery } from "../api/client";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  presentLeaseGap,
  toDisplayDate,
} from "../lib/format";
import { InfoTip } from "../components/InfoTip";

const BUCKET_LABELS: Record<LeaseBucket, string> = {
  "0_30": "0–30 days",
  "31_60": "31–60 days",
  "61_90": "61–90 days",
  "91_180": "91–180 days",
  over_180: "Over 180 days",
  expired: "Expired",
  missing: "Missing",
};

const BUCKET_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All buckets" },
  ...(Object.keys(BUCKET_LABELS) as LeaseBucket[]).map((b) => ({
    value: b,
    label: BUCKET_LABELS[b],
  })),
];

interface DraftFilters {
  property: string;
  bucket: string;
  unit_type: string;
  has_move_out: string;
  has_positive_balance: string;
  rent_gap_min: string;
  rent_gap_max: string;
}

const EMPTY_DRAFT: DraftFilters = {
  property: "",
  bucket: "",
  unit_type: "",
  has_move_out: "",
  has_positive_balance: "",
  rent_gap_min: "",
  rent_gap_max: "",
};

function draftToQuery(draft: DraftFilters): LeaseRiskQuery {
  const query: LeaseRiskQuery = {};
  if (draft.property) query.property = draft.property;
  if (draft.bucket) query.bucket = draft.bucket;
  if (draft.unit_type) query.unit_type = draft.unit_type;
  if (draft.has_move_out === "true") query.has_move_out = true;
  if (draft.has_move_out === "false") query.has_move_out = false;
  if (draft.has_positive_balance === "true") query.has_positive_balance = true;
  if (draft.has_positive_balance === "false") query.has_positive_balance = false;
  if (draft.rent_gap_min !== "") query.rent_gap_min = Number(draft.rent_gap_min);
  if (draft.rent_gap_max !== "") query.rent_gap_max = Number(draft.rent_gap_max);
  return query;
}

export function LeaseRiskPage() {
  const [searchParams] = useSearchParams();
  const [draft, setDraft] = useState<DraftFilters>({
    ...EMPTY_DRAFT,
    property: searchParams.get("property") ?? "",
  });
  const [filters, setFilters] = useState<LeaseRiskQuery>(() =>
    draftToQuery({ ...EMPTY_DRAFT, property: searchParams.get("property") ?? "" })
  );
  const [data, setData] = useState<LeaseRiskSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchLeaseRisks(filters)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [filters]);

  if (error) {
    return <div className="error-banner">Failed to load lease risk: {error}</div>;
  }

  if (!data) {
    return <div className="loading">Loading lease risk…</div>;
  }

  const { metrics } = data;
  const totalLeaseGap = presentLeaseGap(metrics.total_loss_to_lease, "Net");
  return (
    <div className="lease-risk">
      <div className="page-header">
        <h1>Lease Risk</h1>
        <div className="as-of">
          <span className="as-of-label">Data as of</span>
          <span className="as-of-value">{toDisplayDate(data.as_of_date)}</span>
        </div>
      </div>

      <div className="filter-bar">
        <label className="filter-field">
          <span>Property</span>
          <select
            value={draft.property}
            onChange={(e) => setDraft({ ...draft, property: e.target.value })}
          >
            <option value="">All properties</option>
            {data.options.properties.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name ?? p.code}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-field">
          <span>Lease bucket</span>
          <select
            value={draft.bucket}
            onChange={(e) => setDraft({ ...draft, bucket: e.target.value })}
          >
            {BUCKET_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-field">
          <span>Unit type</span>
          <select
            value={draft.unit_type}
            onChange={(e) => setDraft({ ...draft, unit_type: e.target.value })}
          >
            <option value="">All unit types</option>
            {data.options.unit_types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-field">
          <span>Move-out date</span>
          <select
            value={draft.has_move_out}
            onChange={(e) => setDraft({ ...draft, has_move_out: e.target.value })}
          >
            <option value="">Any</option>
            <option value="true">Has move-out</option>
            <option value="false">No move-out</option>
          </select>
        </label>

        <label className="filter-field">
          <span>Balance</span>
          <select
            value={draft.has_positive_balance}
            onChange={(e) => setDraft({ ...draft, has_positive_balance: e.target.value })}
          >
            <option value="">Any</option>
            <option value="true">Positive</option>
            <option value="false">Non-positive</option>
          </select>
        </label>

        <label className="filter-field">
          <span>
            Signed rent gap min ($)
            <InfoTip text="Signed filter value: positive selects Loss-to-Lease; negative selects Gain-to-Lease." />
          </span>
          <input
            type="number"
            value={draft.rent_gap_min}
            onChange={(e) => setDraft({ ...draft, rent_gap_min: e.target.value })}
          />
        </label>

        <label className="filter-field">
          <span>
            Signed rent gap max ($)
            <InfoTip text="Signed filter value: positive selects Loss-to-Lease; negative selects Gain-to-Lease." />
          </span>
          <input
            type="number"
            value={draft.rent_gap_max}
            onChange={(e) => setDraft({ ...draft, rent_gap_max: e.target.value })}
          />
        </label>

        <div className="filter-actions">
          <button
            className="btn btn-primary"
            onClick={() => setFilters({ ...draftToQuery(draft), page: 1 })}
          >
            Apply
          </button>
          <button
            className="btn"
            onClick={() => {
              setDraft(EMPTY_DRAFT);
              setFilters({ page: 1 });
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="kpi-grid kpi-grid-6">
        <div className="kpi-card">
          <div className="kpi-label">Records</div>
          <div className="kpi-value">{formatNumber(metrics.total_records)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Scheduled Base Rent</div>
          <div className="kpi-value">{formatCurrency(metrics.total_scheduled_base_rent)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Market Rent</div>
          <div className="kpi-value">{formatCurrency(metrics.total_market_rent)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">
            {totalLeaseGap.label}
            <InfoTip text="Net market_rent - scheduled_base_rent across comparable occupied units. A positive net amount is Loss-to-Lease; a negative net amount is presented as a positive Gain-to-Lease." />
          </div>
          <div className="kpi-value">{formatCurrency(totalLeaseGap.amount)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">
            Loss-to-Lease Units
            <InfoTip text="Occupied units whose Market Rent exceeds their Scheduled Base Rent, i.e. rented below market." />
          </div>
          <div className="kpi-value">{formatNumber(metrics.positive_loss_to_lease_count)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">
            Gain-to-Lease Units
            <InfoTip text="Occupied units whose Scheduled Base Rent exceeds their Market Rent, i.e. rented above market." />
          </div>
          <div className="kpi-value">{formatNumber(metrics.premium_count)}</div>
        </div>
      </div>

      <div className="chart-card">
        <div className="card-header">
          <h3>Expiration cohort</h3>
          <span className="card-subtitle">Filtered records by bucket</span>
        </div>
        <ul className="bucket-list">
          {(Object.keys(BUCKET_LABELS) as LeaseBucket[]).map((bucket) => (
            <li key={bucket} className="bucket-row">
              <span className="bucket-label">{BUCKET_LABELS[bucket]}</span>
              <span className="bucket-bar-track">
                <span
                  className="bucket-bar"
                  style={{
                    width: `${Math.round((metrics.buckets[bucket] / Math.max(1, metrics.total_records)) * 100)}%`,
                  }}
                />
              </span>
              <span className="bucket-value">{formatNumber(metrics.buckets[bucket])}</span>
            </li>
          ))}
          <li className="bucket-row bucket-total-row">
            <span className="bucket-label">Total</span>
            <span />
            <span className="bucket-value">{formatNumber(metrics.total_records)}</span>
          </li>
        </ul>
      </div>

      <div className="table-card">
        <div className="card-header">
          <h3>Lease Risk Detail</h3>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Property / Unit</th>
                <th>Lease Expiration</th>
                <th>Move-out</th>
                <th className="num">Market Rent</th>
                <th className="num">Base Rent</th>
                <th className="num">
                  Lease gap
                  <InfoTip text="Market Rent versus Scheduled Base Rent. Below-market units show Loss-to-Lease; above-market units show Gain-to-Lease. Blank when base rent is missing or zero." />
                </th>
                <th className="num">Balance</th>
                <th>Availability</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const leaseGap = row.loss_to_lease === null
                  ? null
                  : presentLeaseGap(row.loss_to_lease);
                return (
                  <tr key={`${row.property_code}-${row.unit_code}-${row.resident_id}`}>
                    <td>
                      <Link to={`/properties/${row.property_code}`} className="row-link">
                        {row.property_name ?? row.property_code}
                      </Link>
                      <span className="unit-suffix"> / {row.unit_code}</span>
                    </td>
                    <td>{row.lease_end_date ? toDisplayDate(row.lease_end_date) : "—"}</td>
                    <td>{row.move_out_date ? toDisplayDate(row.move_out_date) : "—"}</td>
                    <td className="num">
                      {row.market_rent !== null ? formatCurrency(row.market_rent) : "—"}
                    </td>
                    <td className="num">{formatCurrency(row.scheduled_base_rent)}</td>
                    <td className="num">
                      {leaseGap
                        ? `${leaseGap.label}: ${formatCurrency(leaseGap.amount)} (${formatPercent(Math.abs(row.loss_to_lease_pct ?? 0), 1)})`
                        : "—"}
                    </td>
                    <td className="num">
                      {row.balance !== null ? formatCurrency(row.balance) : "—"}
                    </td>
                    <td>{row.availability_status.replace(/_/g, " ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card-subtitle" style={{ marginTop: 8 }}>
          {formatNumber(metrics.total_records)} records · showing page {data.pagination.page} of{" "}
          {data.pagination.total_pages} · market rent coverage{" "}
          {formatPercent(data.coverage.market_rent_coverage)} · base rent coverage{" "}
          {formatPercent(data.coverage.base_rent_coverage)}
        </div>
        {data.pagination.total_pages > 1 && (
          <div className="pagination">
            <button
              className="btn"
              disabled={data.pagination.page === 1}
              onClick={() => setFilters({ ...filters, page: data.pagination.page - 1 })}
            >
              Previous
            </button>
            <span className="card-subtitle">
              Page {data.pagination.page} of {data.pagination.total_pages}
            </span>
            <button
              className="btn"
              disabled={data.pagination.page === data.pagination.total_pages}
              onClick={() => setFilters({ ...filters, page: data.pagination.page + 1 })}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
