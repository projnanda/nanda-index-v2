"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { listIndexRecords } from "@/lib/nanda-api";
import { JsonPanel } from "@/components/JsonPanel";
import { PageShell } from "@/components/PageShell";
import { ExploreActions } from "@/components/ExploreActions";
import type { IndexCatalogEntry, TrustManifest } from "@/lib/nanda-types";
import { identityStatus, entryCardStatus } from "@/lib/entryStatus";
import { entryOps } from "@/lib/air";
import {
  OWNER_LABELS,
  PROTOCOL_LABELS,
  discoveryMethodOf,
  inSelection,
  ownerOf,
  protocolOf,
  tallyFacet,
  type FacetTally,
  type Owner,
  type Protocol,
} from "@/lib/entryCategory";
import {
  LINK_PRIVACY_NOTE,
  discoveryLink,
  isPersonalValue,
  navigateDiscovery,
  pageNumber,
  selectedValues,
  selectionParam,
  useDiscoveryLocation,
} from "@/lib/discoveryLocation";
import { FilterSidebar } from "./FilterSidebar";

const PAGE_SIZE = 9;
const SKELETON_TILES = 6;
// Browsers cap how often the address may change, so typing updates it once the
// typing pauses rather than on every keystroke.
const SEARCH_URL_DELAY_MS = 300;

// ── Badges ──────────────────────────────────────────────────────────────────
// Owner and protocol are decided in lib/entryCategory.ts. Each gets its own
// soft, on-brand chip colour so a card reads at a glance.

const OWNER_BADGE: Record<Owner, string> = {
  enterprise: "bg-brand-200 text-brand-700",
  smb: "bg-warning-soft text-warning",
  personal: "bg-[#dcf5e6] text-[#0f7a45]",
};

const PROTOCOL_BADGE: Record<Protocol, string> = {
  a2a: "bg-accent-teal text-accent-teal-ink",
  mcp: "bg-[#e7e3fb] text-[#4b3aa6]",
  skill: "bg-[#fde7ef] text-[#b4185a]",
  catalog: "bg-surface-tag text-ink",
};

const FALLBACK_BADGE = { label: "Agent", className: "bg-surface-tag text-ink" };

interface Badge {
  label: string;
  className: string;
}

/** The owner badge, then the protocol badge; a generic one when the entry has neither. */
function badgesFor(owner: Owner | null, protocol: Protocol | null): Badge[] {
  const badges = [
    ...(owner ? [{ label: OWNER_LABELS[owner], className: OWNER_BADGE[owner] }] : []),
    ...(protocol ? [{ label: PROTOCOL_LABELS[protocol], className: PROTOCOL_BADGE[protocol] }] : []),
  ];
  return badges.length > 0 ? badges : [FALLBACK_BADGE];
}

function BadgeList({ badges }: { badges: Badge[] }) {
  return (
    <span className="flex flex-wrap justify-end gap-1 flex-shrink-0">
      {badges.map((badge) => (
        <span
          key={badge.label}
          data-badge
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${badge.className}`}
        >
          {badge.label}
        </span>
      ))}
    </span>
  );
}

type Row = {
  record: IndexCatalogEntry;
  owner: Owner | null;
  protocol: Protocol | null;
  discovery: string;
  badges: Badge[];
  name: string;
  identifier: string;
  date: string;
  description: string;
  tags: string[];
  identity: ReturnType<typeof identityStatus>;
  version: string | null;
};

function mapRow(record: IndexCatalogEntry): Row {
  const owner = ownerOf(record);
  const protocol = protocolOf(record);
  const name = record.displayName || entryOps(record).orgId;
  const date = record.updatedAt ? new Date(record.updatedAt).toLocaleDateString() : "";
  const description = record.description || record.identifier || entryOps(record).domain || "";

  // De-duplicate tags case-insensitively for the chip row.
  const seen = new Set<string>();
  const tags = (record.tags ?? []).filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    record,
    owner,
    protocol,
    discovery: discoveryMethodOf(record),
    badges: badgesFor(owner, protocol),
    name,
    identifier: record.identifier,
    date,
    description,
    tags,
    identity: identityStatus(record),
    version: record.version ?? null,
  };
}

export default function ExplorePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters, page and the open entry live in the address bar, so the view
  // survives a reload, follows back and forward, and can be shared as a link.
  const { state } = useDiscoveryLocation();
  const ownerFilters = useMemo(() => selectedValues(state.owner, OWNER_LABELS), [state.owner]);
  const protocolFilters = useMemo(() => selectedValues(state.protocol, PROTOCOL_LABELS), [state.protocol]);
  const page = pageNumber(state.page);
  const selected = useMemo(
    () => rows.find((row) => row.identifier === state.entry)?.record ?? null,
    [rows, state.entry],
  );

  // The search box filters as you type; the address catches up when typing
  // pauses. When the address changes underneath (back, forward, a pasted link)
  // the box takes its value from the address.
  const urlSearch = state.q ?? "";
  const [search, setSearch] = useState(urlSearch);
  const [syncedSearch, setSyncedSearch] = useState(urlSearch);
  if (urlSearch !== syncedSearch) {
    setSyncedSearch(urlSearch);
    setSearch(urlSearch);
  }

  useEffect(() => {
    if (search === urlSearch) return;
    const handle = window.setTimeout(() => navigateDiscovery({ q: search, page: "" }, true), SEARCH_URL_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [search, urlSearch]);

  useEffect(() => {
    let cancelled = false;
    listIndexRecords()
      .then((data) => {
        if (cancelled) return;
        setRows(data.map(mapRow));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleOwner(value: Owner) {
    navigateDiscovery({ owner: selectionParam(toggled(ownerFilters, value)), page: "" });
  }

  function toggleProtocol(value: Protocol) {
    navigateDiscovery({ protocol: selectionParam(toggled(protocolFilters, value)), page: "" });
  }

  function goToPage(target: number) {
    navigateDiscovery({ page: target > 1 ? String(target) : "" });
  }

  // Each group is counted against the other group's selection, so an option's
  // count is the number of entries ticking it would show. Null until the index
  // has loaded, so the sidebar never shows a "0" it hasn't counted.
  const loaded = !loading && !error;
  const ownerTally = useMemo<FacetTally<Owner> | null>(
    () => (loaded ? tallyFacet(rows.filter((r) => inSelection(r.protocol, protocolFilters)).map((r) => r.owner)) : null),
    [rows, loaded, protocolFilters],
  );
  const protocolTally = useMemo<FacetTally<Protocol> | null>(
    () => (loaded ? tallyFacet(rows.filter((r) => inSelection(r.owner, ownerFilters)).map((r) => r.protocol)) : null),
    [rows, loaded, ownerFilters],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (
        q &&
        !r.name.toLowerCase().includes(q) &&
        !r.identifier.toLowerCase().includes(q) &&
        !(entryOps(r.record).domain ?? "").toLowerCase().includes(q) &&
        !r.description.toLowerCase().includes(q)
      ) {
        return false;
      }
      return inSelection(r.owner, ownerFilters) && inSelection(r.protocol, protocolFilters);
    });
  }, [rows, search, ownerFilters, protocolFilters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const apiHostname = (() => {
    const url = process.env.NEXT_PUBLIC_NANDA_INDEX_API_URL ?? "";
    try {
      return new URL(url).hostname;
    } catch {
      return url || "the API";
    }
  })();

  return (
    <PageShell
      title="Explore"
      description="Browse every entry listed in the index. Filter entries, or search by name, identifier, or domain."
    >
      <ExploreActions />
      <div className="flex flex-col lg:flex-row gap-6">
        <FilterSidebar
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            if (page !== 1) navigateDiscovery({ page: "" }, true);
          }}
          ownerFilters={ownerFilters}
          protocolFilters={protocolFilters}
          ownerTally={ownerTally}
          protocolTally={protocolTally}
          total={loaded ? rows.length : null}
          onToggleOwner={toggleOwner}
          onToggleProtocol={toggleProtocol}
          onClear={() => {
            setSearch("");
            navigateDiscovery({ owner: "", protocol: "", q: "", page: "" });
          }}
        />

        <div className="flex-1 min-w-0">
          {loading ? (
            <LoadingSkeleton />
          ) : error ? (
            <div className="flex items-center justify-center py-12">
              <div className="bg-surface-light rounded-card border border-line/70 shadow-card p-6 max-w-md text-center">
                <p className="text-sm text-ink-medium">
                  Could not reach {apiHostname}. Check that the API is running.
                </p>
                <p className="mt-2 font-mono text-xs text-ink-weak break-all">{error}</p>
              </div>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="bg-surface-light rounded-card border border-line/70 shadow-card p-6 max-w-md text-center">
                <p className="text-sm text-ink-medium">No index records are registered yet.</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="bg-surface-light rounded-card border border-line/70 shadow-card p-6 max-w-md text-center">
                <p className="text-sm text-ink-medium">No entries match your filters.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {pageItems.map((item) => (
                  <RegistryCard
                    key={item.record.identifier}
                    item={item}
                    onSelect={() => navigateDiscovery({ entry: item.identifier })}
                  />
                ))}
              </div>

              <Pagination
                page={currentPage}
                total={totalPages}
                onPrev={() => goToPage(Math.max(1, currentPage - 1))}
                onNext={() => goToPage(Math.min(totalPages, currentPage + 1))}
                onGoto={goToPage}
              />
            </>
          )}
        </div>
      </div>

      {/* A personal entry's note is shown in its drawer, which covers this part of the page. */}
      {isPersonalValue(urlSearch) && <p className="mt-4 text-xs text-ink-medium">{LINK_PRIVACY_NOTE}</p>}
      {loaded && state.entry && !selected && (
        <p role="status" className="mt-4 text-sm text-ink-medium">
          This shared entry is not available in the index.
        </p>
      )}
      <DetailDrawer record={selected} onClose={() => navigateDiscovery({ entry: "" })} />
    </PageShell>
  );
}

/** A copy of `selected` with `value` added if absent, removed if present. */
function toggled<T>(selected: ReadonlySet<T>, value: T): ReadonlySet<T> {
  return selected.has(value) ? new Set([...selected].filter((v) => v !== value)) : new Set([...selected, value]);
}

function LoadingSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading entries…</span>
      <noscript>
        <p className="text-sm text-ink-medium">Explore needs JavaScript to load index entries.</p>
      </noscript>
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: SKELETON_TILES }, (_, i) => (
          <div key={i} className="bg-surface-strong h-[200px] rounded-card animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function RegistryCard({ item, onSelect }: { item: Row; onSelect: () => void }) {
  return (
    <article
      className="relative bg-surface-light rounded-card border border-line/70 shadow-card p-4 hover:shadow-card-hover hover:border-line-strong transition flex flex-col h-full gap-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="font-semibold text-ink-strong truncate">
              <button type="button" onClick={onSelect} className="text-left cursor-pointer after:absolute after:inset-0 after:rounded-card focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand-500">
                {item.name}
              </button>
            </h3>
          </div>
          <div className="mt-0.5 text-xs text-ink-weak truncate">
            {item.version ? (
              <span className="font-mono text-ink-medium">{item.version}</span>
            ) : null}
            {item.version ? " • " : ""}
            {item.identifier}
            {item.date ? ` • ${item.date}` : ""}
          </div>
        </div>
        <BadgeList badges={item.badges} />
      </div>
      <div className="space-y-1 text-xs text-ink-medium">
        <p>Discovery: {item.discovery}</p>
        <p title="Identity proof checks control of an email address or domain. It does not test the card or runtime.">{item.identity.label}</p>
        <p title={entryCardStatus(item.record).detail}>Card: {entryCardStatus(item.record).label}</p>
        <p>Endpoint: Not checked</p>
      </div>
      <p className="text-sm text-ink line-clamp-2 leading-relaxed">{item.description}</p>
      <ul role="list" aria-label="Tags" className="flex flex-wrap gap-1.5 mt-auto">
        {item.tags.slice(0, 4).map((t) => (
          <li
            key={t}
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-surface-tag text-ink"
          >
            {t}
          </li>
        ))}
      </ul>
    </article>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────
// A right-hand slide-over that surfaces the full record (formerly the right
// panel of the Browse page) when a card is clicked.

function DetailDrawer({ record, onClose }: { record: IndexCatalogEntry | null; onClose: () => void }) {
  const open = !!record;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const badges = record ? badgesFor(ownerOf(record), protocolOf(record)) : [];

  return (
    <div
      aria-hidden={!open}
      className={`fixed inset-0 z-40 ${open ? "" : "pointer-events-none"}`}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-ink-strong/30 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"
          }`}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={record ? `${record.displayName} details` : "Details"}
        className={`absolute right-0 top-0 h-full w-full max-w-lg bg-surface shadow-modal border-l border-line flex flex-col transition-transform duration-200 ease-out ${open ? "translate-x-0" : "translate-x-full"
          }`}
      >
        {record && (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4 flex-shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-ink-strong text-xl truncate">
                    {record.displayName}
                  </h2>
                  <BadgeList badges={badges} />
                </div>
                <p className="mt-0.5 font-mono text-xs text-ink-weak break-all">
                  {record.identifier}
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close details"
                className="flex-shrink-0 rounded-control border border-line bg-surface-light p-1.5 text-ink-medium hover:border-line-strong hover:text-ink transition"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <Link
                href={discoveryLink("/resolve", { urn: record.identifier })}
                className="inline-block rounded-control bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 transition"
              >
                Resolve this identifier
              </Link>
              {isPersonalValue(record.identifier) && (
                <p className="text-xs text-ink-medium">{LINK_PRIVACY_NOTE}</p>
              )}
              <div className="bg-surface-light rounded-card border border-line p-5 shadow-card">
                {entryOps(record).domain && (
                  <p className="text-sm text-ink-medium break-all">{entryOps(record).domain}</p>
                )}
                {record.description && (
                  <p className="mt-2 text-sm leading-relaxed text-ink-medium">
                    {record.description}
                  </p>
                )}
                {record.tags && record.tags.length > 0 && (
                  <ul role="list" aria-label="Tags" className="mt-3 flex flex-wrap gap-1.5">
                    {record.tags.map((tag) => (
                      <li
                        key={tag}
                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-surface-tag text-ink"
                      >
                        {tag}
                      </li>
                    ))}
                  </ul>
                )}
                <dl className="mt-4 grid gap-2 text-sm text-ink">
                  <DetailRow label="Media type">
                    <span className="font-mono text-xs">{record.type ?? "-"}</span>
                  </DetailRow>
                  {record.version && (
                    <DetailRow label="Version">
                      <span className="font-mono text-xs">{record.version}</span>
                    </DetailRow>
                  )}
                  <DetailRow label="Catalog URL">
                    {record.url ? (
                      <a
                        href={record.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all font-mono text-xs text-brand-600 hover:underline"
                      >
                        {record.url}
                      </a>
                    ) : (
                      <span className="text-ink-weak">-</span>
                    )}
                  </DetailRow>
                  <DetailRow label="Discovery">{discoveryMethodOf(record)}</DetailRow>
                  <DetailRow label="TTL">{entryOps(record).ttlSeconds}s</DetailRow>
                  <DetailRow label="Identity">
                    {identityStatus(record).label}. {identityStatus(record).checkedAt ? new Date(identityStatus(record).checkedAt!).toLocaleString(undefined, { timeZoneName: "short" }) : "Verification time not recorded."}
                  </DetailRow>
                  <DetailRow label="Card check">
                    {entryCardStatus(record).label}. {entryCardStatus(record).checkedAt ? new Date(entryCardStatus(record).checkedAt!).toLocaleString(undefined, { timeZoneName: "short" }) : "No check time recorded."}
                    <p className="mt-1 text-xs text-ink-weak">{entryCardStatus(record).detail}</p>
                  </DetailRow>
                  <DetailRow label="Endpoint">Not checked. Identity proof and card checks do not establish runtime availability.</DetailRow>
                  <DetailRow label="Status">
                    <span className="capitalize">{entryOps(record).status}</span>
                  </DetailRow>
                  {entryOps(record).createdAt && (
                    <DetailRow label="Created">
                      {new Date(entryOps(record).createdAt).toLocaleDateString()}
                    </DetailRow>
                  )}
                  <DetailRow label="Updated">
                    {new Date(record.updatedAt).toLocaleDateString()}
                  </DetailRow>
                </dl>
              </div>

              {record.trustManifest && <TrustManifestPanel tm={record.trustManifest} />}

              <JsonPanel data={record} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="font-semibold text-ink-strong flex-shrink-0">{label}:</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

// Surfaces the AI Catalog trust manifest (identity, attestations, provenance,
// signature) as its own panel in the detail drawer.
function TrustManifestPanel({ tm }: { tm: TrustManifest }) {
  const attestations = tm.attestations ?? [];
  const provenance = tm.provenance ?? [];
  return (
    <div className="bg-surface-light rounded-card border border-line p-5 shadow-card">
      <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-weak">Trust Manifest</h3>
      {/* The API marks every manifest trustManifestVerified: false — it is
          whatever the registrant submitted, so say so rather than imply vetting. */}
      <p className="mb-3 text-xs text-ink-weak">Self-asserted by the registrant — not verified by NANDA Index.</p>
      <dl className="grid gap-2 text-sm text-ink">
        <DetailRow label="Identity">
          <span className="font-mono text-xs break-all">{tm.identity}</span>
        </DetailRow>
        {tm.identityType && <DetailRow label="Type">{tm.identityType}</DetailRow>}
        <DetailRow label="Attestations">
          {attestations.length}
          {attestations.length > 0 ? ` (${attestations[0].type})` : ""}
        </DetailRow>
        <DetailRow label="Provenance">
          {provenance.length}
          {provenance.length > 0 ? ` (${provenance[0].relation})` : ""}
        </DetailRow>
        {tm.signature && (
          <DetailRow label="Signature">
            <span className="font-mono text-xs break-all">{tm.signature.slice(0, 24)}…</span>
          </DetailRow>
        )}
      </dl>
    </div>
  );
}

function Pagination(props: {
  page: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onGoto: (p: number) => void;
}) {
  const { page, total } = props;

  // Build page list: show all if <= 5, else 1 / ... / window / ... / N
  const pages: (number | "...")[] = [];
  if (total <= 5) {
    for (let i = 1; i <= total; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("...");
    const start = Math.max(2, page - 1);
    const end = Math.min(total - 1, page + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (page < total - 2) pages.push("...");
    pages.push(total);
  }

  return (
    <nav className="flex items-center justify-center gap-2 mt-6 pb-4">
      <button
        onClick={props.onPrev}
        disabled={page === 1}
        className="px-3 py-1.5 text-sm font-medium rounded text-ink border-2 border-line bg-surface-light hover:border-line-strong disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        Previous
      </button>
      <div className="flex items-center gap-1">
        {pages.map((p, idx) =>
          p === "..." ? (
            <span key={`e-${idx}`} className="px-2 py-1 text-sm text-ink-weak">
              ...
            </span>
          ) : (
            <button
              key={p}
              onClick={() => props.onGoto(p)}
              className={`min-w-9 h-9 px-2 text-sm font-medium rounded-full transition ${p === page ? "bg-brand-500 text-white" : "text-ink hover:bg-surface-strong"
                }`}
            >
              {p}
            </button>
          )
        )}
      </div>
      <button
        onClick={props.onNext}
        disabled={page === total}
        className="px-3 py-1.5 text-sm font-medium rounded text-ink border-2 border-line bg-surface-light hover:border-line-strong disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        Next
      </button>
    </nav>
  );
}
