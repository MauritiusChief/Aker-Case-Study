import { KpiCard } from "./KpiCard";
import { formatCurrency, formatNumber, formatPercent } from "../lib/format";
import type {
  MorningBriefWidget as Widget,
  MorningBriefWidgetType,
  PortfolioKpisWidget,
  PropertyRankingWidget,
  RentGapRankingWidget,
  AvailabilityBreakdownWidget,
  LeaseExpirationWidget,
  DataQualityWidget,
} from "../types";

export const MORNING_BRIEF_WIDGET_REGISTRY = {
  portfolio_kpis: { label: "Portfolio KPIs" },
  property_ranking: { label: "Property ranking" },
  availability_breakdown: { label: "Availability breakdown" },
  lease_expiration: { label: "Lease expiration" },
  rent_gap_ranking: { label: "Rent gap ranking" },
  data_quality: { label: "Data quality" },
} satisfies Record<MorningBriefWidgetType, { label: string }>;

interface MorningBriefWidgetProps {
  widget: Widget;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
}

function PortfolioKpis({ widget }: { widget: PortfolioKpisWidget }) {
  return (
    <div className="brief-kpi-grid">
      {widget.data.items.map((item, index) => {
        const value = item.format === "currency"
          ? formatCurrency(item.value)
          : item.format === "percent"
            ? formatPercent(item.value)
            : formatNumber(item.value);
        return <KpiCard key={`${item.label}-${index}`} label={item.label} value={value} hint={item.hint} />;
      })}
    </div>
  );
}

function PropertyRanking({ widget }: { widget: PropertyRankingWidget }) {
  return (
    <div className="table-scroll">
      <table className="data-table brief-ranking-table">
        <thead>
          <tr>
            <th>Property</th>
            <th className="num">Avail.</th>
            <th className="num">Occupancy</th>
            <th className="num">Leased</th>
            <th className="num">Exp. 60d</th>
            <th className="num">Exposure</th>
          </tr>
        </thead>
        <tbody>
          {widget.data.rows.map((row) => (
            <tr key={row.property_code}>
              <td>{row.property_name ?? row.property_code}</td>
              <td className="num">{formatNumber(row.avail)}</td>
              <td className="num">{formatPercent(row.occ_pct)}</td>
              <td className="num">{formatPercent(row.leased_pct)}</td>
              <td className="num">{formatNumber(row.expiring_60)}</td>
              <td className="num">{formatCurrency(row.vacant_unrented_exposure)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RentGapRanking({ widget }: { widget: RentGapRankingWidget }) {
  const max = Math.max(1, ...widget.data.rows.map((row) => Math.abs(row.total_loss_to_lease ?? 0)));
  return (
    <div className="rent-gap-list">
      {widget.data.rows.map((row) => {
        const gap = row.total_loss_to_lease ?? 0;
        return (
          <div className="rent-gap-row" key={row.property_code}>
            <div>
              <strong>{row.property_name ?? row.property_code}</strong>
              <span>{formatNumber(row.comparable_units)} comparable units</span>
            </div>
            <div className="rent-gap-track" aria-hidden="true">
              <span className={gap < 0 ? "negative" : ""} style={{ width: `${Math.abs(gap) / max * 100}%` }} />
            </div>
            <strong className="rent-gap-value">{formatCurrency(gap)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function AvailabilityBreakdown({ widget }: { widget: AvailabilityBreakdownWidget }) {
  return (
    <div className="semantic-bar-list">
      {widget.data.rows.map((row) => (
        <div className="semantic-bar-row" key={row.property_code}>
          <div><strong>{row.property_name ?? row.property_code}</strong><span>{formatNumber(row.available_units)} available · {formatNumber(row.notice_unrented)} notice unrented · {formatNumber(row.down_units)} down</span></div>
          <div className="semantic-bar-track"><span style={{ width: `${Math.max(0, Math.min(100, row.occupancy_pct))}%` }} /></div>
          <strong>{formatPercent(row.occupancy_pct)}</strong>
        </div>
      ))}
    </div>
  );
}

function LeaseExpirations({ widget }: { widget: LeaseExpirationWidget }) {
  const max = Math.max(1, ...widget.data.rows.map((row) => row.expiring_60));
  return (
    <div className="semantic-bar-list">
      {widget.data.rows.map((row) => (
        <div className="semantic-bar-row" key={row.property_code}>
          <div><strong>{row.property_name ?? row.property_code}</strong><span>Leases expiring within 60 days</span></div>
          <div className="semantic-bar-track lease"><span style={{ width: `${row.expiring_60 / max * 100}%` }} /></div>
          <strong>{formatNumber(row.expiring_60)}</strong>
        </div>
      ))}
    </div>
  );
}

function DataQuality({ widget }: { widget: DataQualityWidget }) {
  return (
    <div className="brief-quality">
      <div className="brief-quality-counts"><strong>{formatNumber(widget.data.error_count)} errors</strong><strong>{formatNumber(widget.data.warning_count)} warnings</strong></div>
      {widget.data.by_code.length > 0 && <ul>{widget.data.by_code.map((row) => <li key={`${row.code}-${row.severity}`}><code>{row.code}</code><span>{row.severity}</span><strong>{formatNumber(row.count)}</strong></li>)}</ul>}
      {widget.data.limitations.length > 0 && <div className="brief-limitations"><strong>Limitations</strong>{widget.data.limitations.map((limitation, index) => <p key={index}>{limitation}</p>)}</div>}
    </div>
  );
}

function WidgetBody({ widget }: { widget: Widget }) {
  switch (widget.type) {
    case "portfolio_kpis":
      return <PortfolioKpis widget={widget} />;
    case "property_ranking":
      return <PropertyRanking widget={widget} />;
    case "availability_breakdown":
      return <AvailabilityBreakdown widget={widget} />;
    case "lease_expiration":
      return <LeaseExpirations widget={widget} />;
    case "rent_gap_ranking":
      return <RentGapRanking widget={widget} />;
    case "data_quality":
      return <DataQuality widget={widget} />;
  }
}

export function MorningBriefWidget({ widget, onTogglePin, onDelete }: MorningBriefWidgetProps) {
  return (
    <article className={`morning-widget${widget.pinned ? " morning-widget-pinned" : ""}`}>
      <header className="morning-widget-header">
        <div>
          <span className="widget-kind">{MORNING_BRIEF_WIDGET_REGISTRY[widget.type].label}</span>
          <h2>{widget.title}</h2>
          {widget.subtitle && <p>{widget.subtitle}</p>}
        </div>
        <div className="widget-actions">
          <button className="icon-btn" type="button" onClick={() => onTogglePin(widget.id)}>
            {widget.pinned ? "Unpin" : "Pin"}
          </button>
          <button className="icon-btn icon-btn-danger" type="button" onClick={() => onDelete(widget.id)}>
            Delete
          </button>
        </div>
      </header>
      <div className="morning-widget-body"><WidgetBody widget={widget} /></div>
    </article>
  );
}
