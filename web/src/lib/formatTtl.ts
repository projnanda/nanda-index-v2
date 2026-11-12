const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
/** Whole days read better than hours from this point (7 days, not 168 hours). */
const DAYS_FROM_SECONDS = 2 * SECONDS_PER_DAY;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** Formats a record's ttl_seconds as a readable duration, e.g. 86400 → "24 hours". */
export function formatTtl(seconds: number): string {
  if (!Number.isInteger(seconds) || seconds < 0) return "an unspecified time";
  if (seconds >= DAYS_FROM_SECONDS && seconds % SECONDS_PER_DAY === 0) return plural(seconds / SECONDS_PER_DAY, "day");
  if (seconds >= SECONDS_PER_HOUR && seconds % SECONDS_PER_HOUR === 0) return plural(seconds / SECONDS_PER_HOUR, "hour");
  if (seconds >= SECONDS_PER_MINUTE && seconds % SECONDS_PER_MINUTE === 0) return plural(seconds / SECONDS_PER_MINUTE, "minute");
  return plural(seconds, "second");
}
