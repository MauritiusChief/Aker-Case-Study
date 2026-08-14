import type { ReactNode } from "react";
import { InfoTip } from "./InfoTip";

interface KpiCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  info?: string;
}

export function KpiCard({ label, value, hint, info }: KpiCardProps) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">
        {label}
        {info ? <InfoTip text={info} /> : null}
      </div>
      <div className="kpi-value">{value}</div>
      {hint ? <div className="kpi-hint">{hint}</div> : null}
    </div>
  );
}
