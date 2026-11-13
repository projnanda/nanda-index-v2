import { useId, type ReactNode } from "react";
import { formatTimestamp } from "@/lib/formatTimestamp";
import { formatTtl } from "@/lib/formatTtl";
import type { IndexRecord } from "@/lib/nanda-types";

type ListingFields = Pick<IndexRecord, "status" | "moderation" | "domain" | "domain_verified" | "domain_verified_at"
  | "email_verified" | "email_verified_at" | "updated_at" | "ttl_seconds">;

/** Whether the entry appears in public listings, in words (the badge colours are not the only cue). */
function listingState(org: ListingFields): string {
  if (org.moderation === "takedown") return "Taken down by an index operator";
  if (org.moderation === "hidden") return "Hidden by an index operator: resolvable by exact identifier, not listed";
  if (org.status === "pending") return "Not listed yet: waiting for verification";
  if (org.status === "suspended") return "Not listed: suspended";
  return "Listed in the public index";
}

function verificationText(verified: boolean, at: string | null | undefined): string {
  if (!verified) return "Not verified";
  return at ? `Verified ${formatTimestamp(at)}` : "Verified";
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="font-medium">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Read-only listing status for the owner. Listings have no expiry or renewal
 * in the index; ttl_seconds is only a cache hint for resolvers.
 */
export function ListingStatus({ org }: { org: ListingFields }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm space-y-3">
      <h2 id={headingId} className="text-sm font-semibold text-slate-900">Listing status</h2>
      <dl className="grid gap-2 text-sm text-slate-700">
        <Row label="Listing">{listingState(org)}</Row>
        {org.domain && <Row label="Domain">{verificationText(org.domain_verified, org.domain_verified_at)}</Row>}
        <Row label="Contact email">{verificationText(org.email_verified, org.email_verified_at)}</Row>
        <Row label="Last updated">{formatTimestamp(org.updated_at)}</Row>
        <Row label="Cache TTL">Resolvers may cache this record for {formatTtl(org.ttl_seconds)}.</Row>
      </dl>
      <p className="text-xs text-slate-500">
        Listings do not expire and need no renewal: an active entry stays listed until it is suspended or deleted.
        The cache TTL only tells resolvers how long they may reuse a copy before fetching it again.
      </p>
    </section>
  );
}
