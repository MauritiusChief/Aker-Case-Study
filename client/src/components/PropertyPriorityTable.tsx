import { Link } from "react-router-dom";
import type { PropertyPriorityRow } from "../types";
import { formatCurrency, formatPercent } from "../lib/format";
import { InfoTip } from "./InfoTip";

interface PropertyPriorityTableProps {
  rows: PropertyPriorityRow[];
}

export function PropertyPriorityTable({ rows }: PropertyPriorityTableProps) {
  return (
    <div className="table-card">
      <div className="card-header">
        <h3>Property Priority</h3>
        <span className="card-subtitle">Sorted by vacant unrented exposure</span>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Property</th>
              <th className="num">Units</th>
              <th className="num">Avail</th>
              <th className="num">Occ%</th>
              <th className="num">Leased%</th>
              <th className="num">Exp. 60d</th>
              <th className="num">
                Vacant Unrented Exposure
                <InfoTip text="Total Market Rent of vacant_unrented units (VACANT, no future resident booked) for this property." />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.property_code}>
                <td>
                  <Link
                    to={`/properties/${row.property_code}`}
                    className="row-link"
                  >
                    {row.property_name ?? row.property_code}
                  </Link>
                </td>
                <td className="num">{row.total_units}</td>
                <td className="num">{row.avail}</td>
                <td className="num">{formatPercent(row.occ_pct)}</td>
                <td className="num">{formatPercent(row.leased_pct)}</td>
                <td className="num">{row.expiring_60}</td>
                <td className="num">{formatCurrency(row.vacant_unrented_exposure)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
