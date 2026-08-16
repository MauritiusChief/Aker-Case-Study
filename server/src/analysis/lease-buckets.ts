/** Walkthrough note: Deterministically assigns lease ends to shared expiration cohorts. */
import { daysBetween, isIsoDate } from "../lib/dates.js";

export interface LeaseExpirationBuckets {
  "0_30": number;
  "31_60": number;
  "61_90": number;
  "91_180": number;
  over_180: number;
  expired: number;
  missing: number;
}

export type LeaseBucket = keyof LeaseExpirationBuckets;

export const LEASE_BUCKETS: readonly LeaseBucket[] = [
  "0_30",
  "31_60",
  "61_90",
  "91_180",
  "over_180",
  "expired",
  "missing",
];

export const EMPTY_LEASE_BUCKETS: LeaseExpirationBuckets = {
  "0_30": 0,
  "31_60": 0,
  "61_90": 0,
  "91_180": 0,
  over_180: 0,
  expired: 0,
  missing: 0,
};

export function bucketizeLeaseEnd(
  asOfDate: string,
  leaseEnd: string | null | undefined
): LeaseBucket {
  if (leaseEnd === null || leaseEnd === undefined || leaseEnd === "" || !isIsoDate(leaseEnd)) {
    return "missing";
  }
  const days = daysBetween(asOfDate, leaseEnd);
  if (days < 0) return "expired";
  if (days <= 30) return "0_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  if (days <= 180) return "91_180";
  return "over_180";
}
