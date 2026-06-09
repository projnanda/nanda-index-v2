export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function truncate(value: string, max = 40) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}