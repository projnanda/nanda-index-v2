"use client";

import { useEffect, useMemo, useState } from "react";
import { listIndexRecords } from "@/lib/nanda-api";
import { JsonPanel } from "@/components/JsonPanel";
import { toCatalogEntry } from "@/lib/catalog-entry";
import type { IndexRecord, TrustManifest } from "@/lib/nanda-types";

const PAGE_SIZE = 9;

// ── Categories ──────────────────────────────────────────────────────────────
// Exactly six categories. MCPs and Skills are driven purely by media_type;
// Enterprise / DNS-AID / SMBs / Personal are derived from media_type plus tags.

type Category = "enterprise" | "dns-aid" | "smb" | "personal" | "mcp" | "skill";

const CATEGORIES: { key: Category; label: string }[] = [
  { key: "enterprise", label: "Enterprise" },
  { key: "dns-aid", label: "DNS-AID" },
  { key: "smb", label: "SMBs" },
  { key: "personal", label: "Personal" },
  { key: "mcp", label: "MCPs" },
  { key: "skill", label: "Skills" },
];

const CATEGORY_LABEL: Record<Category, string> = {
  enterprise: "Enterprise",
  "dns-aid": "DNS-AID",
  smb: "SMB",
  personal: "Personal",
  mcp: "MCP",
  skill: "Skill",
};

// Soft, on-brand chip colors so each category reads at a glance.
const CATEGORY_BADGE: Record<Category, string> = {
  enterprise: "bg-brand-200 text-brand-700",
  "dns-aid": "bg-accent-teal text-accent-teal-ink",
  smb: "bg-warning-soft text-warning",
  personal: "bg-[#dcf5e6] text-[#0f7a45]",
  mcp: "bg-[#e7e3fb] text-[#4b3aa6]",
  skill: "bg-[#fde7ef] text-[#b4185a]",
};

const FALLBACK_BADGE = "bg-surface-tag text-ink";

/** Map a single record to one of the six categories, or null when it fits none. */
function categoryOf(record: IndexRecord): Category | null {
  const mt = record.media_type ?? "";
  const tags = (record.tags ?? []).map((t) => t.toLowerCase());

  // Media-type-driven categories take priority.
  if (mt === "application/mcp-server-card+json") return "mcp";
  if (mt === "application/agentskill+zip") return "skill";
  if (mt === "application/vnd.dns-aid+json") return "dns-aid";
  if (mt === "application/ai-catalog+json") return "enterprise";

  // A2A agent cards split into Personal vs SMB by their tags.
  if (mt === "application/a2a-agent-card+json") {
    if (tags.includes("personal-agent") || tags.includes("email-identity")) return "personal";
    if (tags.includes("smb")) return "smb";
  }
  return null;
}

type Row = {
  record: IndexRecord;
  category: Category | null;
  badgeLabel: string;
  badgeClass: string;
  name: string;
  identifier: string;
  date: string;
  description: string;
  tags: string[];
  verified: boolean;
  version: string | null;
};

function mapRow(record: IndexRecord): Row {
  const category = categoryOf(record);
  const name = record.display_name || record.org_id;
  const date = record.updated_at ? new Date(record.updated_at).toLocaleDateString() : "";
  const description = record.description || record.identifier || record.domain || "";

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
    category,
    badgeLabel: category ? CATEGORY_LABEL[category] : "Agent",
    badgeClass: category ? CATEGORY_BADGE[category] : FALLBACK_BADGE,
    name,
    identifier: record.identifier ?? record.org_id,
    date,
    description,
    tags,
    verified: !!record.email_verified,
    version: record.version ?? null,
  };
}

export default function ExplorePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [categoryFilters, setCategoryFilters] = useState<Set<Category>>(new Set());
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<IndexRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
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

  function toggleCategory(value: Category) {
    setCategoryFilters((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
    setPage(1);
  }

  const categoryCounts = useMemo(() => {
    const counts = new Map<Category, number>();
    rows.forEach((r) => {
      if (r.category) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    });
    return counts;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (
        q &&
        !r.name.toLowerCase().includes(q) &&
        !r.identifier.toLowerCase().includes(q) &&
        !(r.record.domain ?? "").toLowerCase().includes(q) &&
        !r.description.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (categoryFilters.size > 0 && (!r.category || !categoryFilters.has(r.category))) {
        return false;
      }
      return true;
    });
  }, [rows, search, categoryFilters]);

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
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h2 className="font-display text-2xl font-bold text-ink-strong leading-tight">Explore</h2>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <FilterSidebar
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          categoryFilters={categoryFilters}
          categoryCounts={categoryCounts}
          onToggleCategory={toggleCategory}
          onClear={() => {
            setCategoryFilters(new Set());
            setSearch("");
            setPage(1);
          }}
        />

        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-surface-strong h-[200px] rounded-card animate-pulse"
                />
              ))}
            </div>
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
                <p className="text-sm text-ink-medium">No org/registrys registered yet.</p>
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
                    key={item.record.org_id}
                    item={item}
                    onSelect={() => setSelected(item.record)}
                  />
                ))}
              </div>

              <Pagination
                page={currentPage}
                total={totalPages}
                onPrev={() => setPage((p) => Math.max(1, p - 1))}
                onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
                onGoto={(p) => setPage(p)}
              />
            </>
          )}
        </div>
      </div>

      <DetailDrawer record={selected} onClose={() => setSelected(null)} />
    </main>
  );
}

function FilterSidebar(props: {
  search: string;
  onSearchChange: (v: string) => void;
  categoryFilters: Set<Category>;
  categoryCounts: Map<Category, number>;
  onToggleCategory: (v: Category) => void;
  onClear: () => void;
}) {
  const hasActive = props.categoryFilters.size > 0 || props.search.trim().length > 0;
  return (
    <aside className="lg:w-64 flex-shrink-0">
      <div className="bg-surface-strong rounded-card border border-line p-4 space-y-5 sticky top-24">
        <div>
          <label
            htmlFor="search"
            className="block text-xs font-semibold uppercase tracking-wide text-ink-medium mb-1.5"
          >
            Search
          </label>
          <input
            type="text"
            id="search"
            placeholder="Filter by name, identifier, or domain..."
            value={props.search}
            onChange={(e) => props.onSearchChange(e.target.value)}
            className="w-full rounded-control border-2 border-line bg-surface-light px-3 py-2 text-sm text-ink placeholder:text-ink-weak focus:outline-none focus:border-brand-500"
          />
        </div>

        <div>
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-medium mb-2">
            Category
          </span>
          <div className="space-y-1.5">
            {CATEGORIES.map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center justify-between gap-2 text-sm text-ink cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={props.categoryFilters.has(key)}
                    onChange={() => props.onToggleCategory(key)}
                    className="rounded border-line-strong text-brand-500 focus:ring-brand-500"
                  />
                  <span>{label}</span>
                </span>
                <span className="text-xs text-ink-weak tabular-nums">
                  {props.categoryCounts.get(key) ?? 0}
                </span>
              </label>
            ))}
          </div>
        </div>

        {hasActive && (
          <button
            onClick={props.onClear}
            className="text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>
    </aside>
  );
}

function RegistryCard({ item, onSelect }: { item: Row; onSelect: () => void }) {
  return (
    <article
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="bg-surface-light rounded-card border border-line/70 shadow-card p-4 hover:shadow-card-hover hover:border-line-strong transition cursor-pointer flex flex-col h-full gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="font-semibold text-ink-strong truncate">{item.name}</h3>
            {item.verified && (
              <span className="inline-flex flex-shrink-0" title="Verified">
                <svg
                  className="w-4 h-4 text-brand-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fillRule="evenodd"
                    d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
            )}
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
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${item.badgeClass}`}
        >
          {item.badgeLabel}
        </span>
      </div>
      <p className="text-sm text-ink line-clamp-2 leading-relaxed">{item.description}</p>
      <div className="flex flex-wrap gap-1.5 mt-auto">
        {item.tags.slice(0, 4).map((t) => (
          <span
            key={t}
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-surface-tag text-ink"
          >
            {t}
          </span>
        ))}
      </div>
    </article>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────
// A right-hand slide-over that surfaces the full record (formerly the right
// panel of the Browse page) when a card is clicked.

function DetailDrawer({ record, onClose }: { record: IndexRecord | null; onClose: () => void }) {
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

  const category = record ? categoryOf(record) : null;
  const badgeClass = category ? CATEGORY_BADGE[category] : FALLBACK_BADGE;
  const badgeLabel = category ? CATEGORY_LABEL[category] : "Agent";

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
        aria-label={record ? `${record.display_name} details` : "Details"}
        className={`absolute right-0 top-0 h-full w-full max-w-lg bg-surface shadow-modal border-l border-line flex flex-col transition-transform duration-200 ease-out ${open ? "translate-x-0" : "translate-x-full"
          }`}
      >
        {record && (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4 flex-shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-ink-strong text-xl truncate">
                    {record.display_name}
                  </h2>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${badgeClass}`}
                  >
                    {badgeLabel}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-xs text-ink-weak break-all">
                  {record.identifier ?? record.org_id}
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
              <div className="bg-surface-light rounded-card border border-line p-5 shadow-card">
                {record.domain && (
                  <p className="text-sm text-ink-medium break-all">{record.domain}</p>
                )}
                {record.description && (
                  <p className="mt-2 text-sm leading-relaxed text-ink-medium">
                    {record.description}
                  </p>
                )}
                {record.tags && record.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {record.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-surface-tag text-ink"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <dl className="mt-4 grid gap-2 text-sm text-ink">
                  <DetailRow label="Media type">
                    <span className="font-mono text-xs">{record.media_type ?? "-"}</span>
                  </DetailRow>
                  {record.version && (
                    <DetailRow label="Version">
                      <span className="font-mono text-xs">{record.version}</span>
                    </DetailRow>
                  )}
                  <DetailRow label="Catalog URL">
                    {record.registry_url ? (
                      <a
                        href={record.registry_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all font-mono text-xs text-brand-600 hover:underline"
                      >
                        {record.registry_url}
                      </a>
                    ) : (
                      <span className="text-ink-weak">-</span>
                    )}
                  </DetailRow>
                  <DetailRow label="TTL">{record.ttl_seconds}s</DetailRow>
                  <DetailRow label="Email verified">
                    {record.email_verified ? "Yes" : "No"}
                  </DetailRow>
                  <DetailRow label="Status">
                    <span className="capitalize">{record.status}</span>
                  </DetailRow>
                  <DetailRow label="Created">
                    {new Date(record.created_at).toLocaleDateString()}
                  </DetailRow>
                </dl>
              </div>

              {record.trust_manifest && <TrustManifestPanel tm={record.trust_manifest} />}

              <JsonPanel data={toCatalogEntry(record)} />
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
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-weak">Trust Manifest</h3>
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
              className={`min-w-9 h-9 px-2 text-sm font-medium rounded-full transition ${p === page ? "bg-brand-500 text-on-brand" : "text-ink hover:bg-surface-strong"
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
