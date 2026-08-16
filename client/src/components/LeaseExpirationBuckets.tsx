/** Walkthrough note: Displays deterministic lease-expiration cohorts from the snapshot. */
import type { LeaseExpirationBuckets } from "../types";
import { formatNumber } from "../lib/format";

interface LeaseExpirationBucketsProps {
  buckets: LeaseExpirationBuckets;
}

const ITEMS: { key: keyof LeaseExpirationBuckets; label: string }[] = [
  { key: "0_30", label: "0–30 days" },
  { key: "31_60", label: "31–60 days" },
  { key: "61_90", label: "61–90 days" },
  { key: "91_180", label: "91–180 days" },
  { key: "over_180", label: "Over 180 days" },
  { key: "expired", label: "Expired" },
  { key: "missing", label: "Missing" },
];

export function LeaseExpirationBuckets({ buckets }: LeaseExpirationBucketsProps) {
  const max = Math.max(1, ...ITEMS.map((item) => buckets[item.key]));
  return (
    <div className="chart-card">
      <div className="card-header">
        <h3>Lease Expiration Buckets</h3>
        <span className="card-subtitle">Derived from the current snapshot</span>
      </div>
      <ul className="bucket-list">
        {ITEMS.map((item) => {
          const value = buckets[item.key];
          return (
            <li key={item.key} className="bucket-row">
              <span className="bucket-label">{item.label}</span>
              <span className="bucket-bar-track">
                <span
                  className="bucket-bar"
                  style={{ width: `${(value / max) * 100}%` }}
                />
              </span>
              <span className="bucket-value">{formatNumber(value)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
