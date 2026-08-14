const ISO_DATE_RE = /^(\d{4})\/(\d{2})\/(\d{2})$/;

export function isIsoDate(value: string | null | undefined): boolean {
  return typeof value === "string" && ISO_DATE_RE.test(value) && isValidDate(value);
}

export function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!isValidDate(value)) return null;
  return date;
}

function isValidDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function formatIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

export function addDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  if (!date) throw new Error(`Invalid ISO date: ${value}`);
  return formatIsoDate(new Date(date.getTime() + days * 86_400_000));
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if (!from || !to) throw new Error(`Invalid ISO date range: ${fromIso}..${toIso}`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function toMonthYear(value: string): string | null {
  if (!isIsoDate(value)) return null;
  return value.slice(0, 7);
}
