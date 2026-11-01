/** Select a management destination from the actual card host, not its URN authority. */
export function cardManagement(cardUrl: string | null | undefined): { url: string; hostedByHost39: boolean } | null {
  if (!cardUrl) return null;
  try {
    const url = new URL(cardUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    const hostedByHost39 = hostname === "host39.org" || hostname.endsWith(".host39.org");
    return { url: hostedByHost39 ? "https://host39.org" : cardUrl, hostedByHost39 };
  } catch {
    return null;
  }
}
