/** Format dashboard timestamps consistently. */
export function formatTimestamp(value: string, locales?: Intl.LocalesArgument, timeZone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return date.toLocaleString(locales, { timeZone, timeZoneName: "short" });
}
