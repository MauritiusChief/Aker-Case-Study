import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AvailabilitySummary } from "../types";
import { formatPercent } from "../lib/format";

interface AvailabilityChartProps {
  data: AvailabilitySummary[];
}

type Mode = "count" | "percent";

const SEGMENTS = [
  { key: "occupied_no_notice", name: "Occupied (no notice)", color: "#2563eb" },
  { key: "notice_rented", name: "Notice (re-rented)", color: "#7c3aed" },
  { key: "notice_unrented", name: "Notice (unrented)", color: "#db2777" },
  { key: "vacant_rented", name: "Vacant (rented)", color: "#059669" },
  { key: "vacant_unrented", name: "Vacant (unrented)", color: "#ea580c" },
  { key: "non_revenue", name: "Model / Down / Admin", color: "#9ca3af" },
] as const;

interface ChartRow {
  property_code: string;
  property_name: string;
  [key: string]: string | number;
}

function buildRows(data: AvailabilitySummary[], mode: Mode): ChartRow[] {
  return data.map((row) => {
    const nonRevenue = row.model + row.down + row.admin;
    const base: ChartRow = {
      property_code: row.property_code,
      property_name: row.property_name ?? row.property_code,
    };
    for (const seg of SEGMENTS) {
      const raw =
        seg.key === "non_revenue"
          ? nonRevenue
          : row[seg.key as keyof AvailabilitySummary] as number;
      base[seg.key] =
        mode === "percent" && row.total_units > 0
          ? Math.round((raw / row.total_units) * 1000) / 10
          : raw;
    }
    return base;
  });
}

export function AvailabilityChart({ data }: AvailabilityChartProps) {
  const [mode, setMode] = useState<Mode>("count");

  const rows = buildRows(data, mode);

  return (
    <div className="chart-card">
      <div className="card-header">
        <h3>Availability Composition</h3>
        <div className="toggle">
          <button
            className={mode === "count" ? "toggle-active" : ""}
            onClick={() => setMode("count")}
          >
            Units
          </button>
          <button
            className={mode === "percent" ? "toggle-active" : ""}
            onClick={() => setMode("percent")}
          >
            Percent
          </button>
        </div>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height={Math.max(360, data.length * 24)}>
          <BarChart data={rows} layout="vertical" margin={{ left: 16, right: 24, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v) => (mode === "percent" ? `${v}%` : String(v))}
            />
            <YAxis
              type="category"
              dataKey="property_name"
              width={180}
              tick={{ fontSize: 12 }}
            />
            <Tooltip
              formatter={(value: number, name: string) => [
                mode === "percent" ? formatPercent(value, 1) : value,
                SEGMENTS.find((s) => s.key === name)?.name ?? name,
              ]}
            />
            <Legend />
            {SEGMENTS.map((seg) => (
              <Bar
                key={seg.key}
                dataKey={seg.key}
                stackId="a"
                fill={seg.color}
                name={seg.key}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
