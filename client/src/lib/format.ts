/** Walkthrough note: Shared display formatting for snapshot dates, CAD values, and KPIs. */
export function toDisplayDate(value: string): string {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[2]}/${match[3]}/${match[1]}`;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number, digits = 2): string {
  return `${value.toFixed(digits)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-CA").format(value);
}

export function presentLeaseGap(value: number, qualifier?: "Net" | "Average"): {
  label: string;
  amount: number;
} {
  // Non-LLM analytics retain a signed gap; the UI converts its direction into
  // positive Loss-to-Lease or Gain-to-Lease terminology at presentation time.
  const terminology = value > 0
    ? "Loss-to-Lease"
    : value < 0
      ? "Gain-to-Lease"
      : "Rent Gap";
  return {
    label: qualifier ? `${qualifier} ${terminology}` : terminology,
    amount: Math.abs(value),
  };
}
