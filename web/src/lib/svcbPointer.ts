import type { IndexCatalogEntry } from "@/lib/nanda-types";
import { nandaField } from "@/lib/air";

const NO_URL = "No URL to follow — inline data or custom discovery path.";

/**
 * The publisher domain a DNS SVCB pointer entry is discovered at, or null for
 * any other entry. Taken from the registered domain, else the URN's publisher
 * segment (urn:air:<domain>:...).
 */
export function svcbPointerDomain(entry: IndexCatalogEntry): string | null {
  if (nandaField(entry, "resolutionRole") !== "dns-svcb-pointer") return null;
  const domain = nandaField(entry, "domain") ?? entry.identifier.split(":")[2];
  return domain ? domain.toLowerCase() : null;
}

/**
 * Why hop 2 has nothing to fetch for an entry with no URL. A DNS SVCB pointer
 * is discovered through its domain's service binding records rather than a
 * URL, so say where to look instead of dead-ending.
 */
export function noUrlExplanation(entry: IndexCatalogEntry): string {
  const domain = svcbPointerDomain(entry);
  if (!domain) return NO_URL;
  return `This agent is discovered via DNS SVCB (RFC 9460) at ${domain}, not through a URL in its index entry. ` +
    `Look up its service binding records, e.g. "dig ${domain} SVCB" or "dig ${domain} HTTPS".`;
}
