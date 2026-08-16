/** Walkthrough note: Central mapping for charges that count as scheduled base rent. */
export const BASE_RENT_CHARGE_CODES: readonly string[] = [
  "RENT",
  "RENTAFF",
  "RENTHAP",
  "RENTRETL",
  "RNTPROF",
  "MTM",
];

export function isBaseRentCharge(chargeCode: string | null): boolean {
  if (chargeCode === null) return false;
  return BASE_RENT_CHARGE_CODES.includes(chargeCode.trim().toUpperCase());
}
