"use client";

import { useEffect, useMemo, useState } from "react";
import { listIndexRecords } from "@/lib/nanda-api";
import type { IndexRecord } from "@/lib/nanda-types";

type Registry = {
  id: string;
  name: string;
  type: string;
  version: string;
  date: string;
  identifier: string;
  description: string;
  tags: string[];
  verified: boolean;
  status: string;
  typeBadge: string;
};

const PAGE_SIZE = 6;

function getTypeBadge(record: IndexRecord): string {
  const mt = record.media_type ?? "";
  const tags = record.tags ?? [];
  if (mt === "application/ai-catalog+json" && tags.includes("enterprise")) return "ENTERPRISE";
  if (mt === "application/ai-catalog+json") return "CATALOG";
  if (mt === "application/vnd.dns-aid+json") return "DNS-AID";
  if (mt === "application/a2a-agent-card+json" && tags.includes("personal-agent")) return "PERSONAL";
  if (mt === "application/a2a-agent-card+json" && tags.includes("smb")) return "SMB";
  if (mt === "application/mcp-server-card+json" && tags.includes("enterprise")) return "MCP ENTERPRISE";
  if (mt === "application/mcp-server-card+json") return "MCP";
  if (mt === "application/agentskill+zip" && tags.includes("enterprise")) return "SKILL ENTERPRISE";
  if (mt === "application/agentskill+zip") return "SKILL";
  const first = tags[0];
  return first ? first.toUpperCase() : "CUSTOM";
}

function toCapitalized(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function mapRecord(record: IndexRecord): Registry {
  const badge = getTypeBadge(record);
  const name = record.display_name || record.org_id;
  const date = record.updated_at ? new Date(record.updated_at).toLocaleDateString() : "";
  const description = record.description || record.identifier || record.domain || "";
  const baseTags = record.tags ?? [];
  const merged = [badge, ...baseTags];
  const seen = new Set<string>();
  const tags = merged.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    id: record.org_id,
    name,
    type: badge,
    version: badge,
    date,
    identifier: record.identifier ?? record.org_id,
    description,
    tags,
    verified: !!record.email_verified,
    status: toCapitalized(record.status),
    typeBadge: badge,
  };
}

export default function HomePage() {
  const [records, setRecords] = useState<Registry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());
  const [tagFilters, setTagFilters] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listIndexRecords()
      .then((data) => {
        if (cancelled) return;
        setRecords(data.map(mapRecord));
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

  function toggle(set: Set<string>, value: string, updater: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    updater(next);
    setPage(1);
  }

  const typeOptions = useMemo(() => {
    const s = new Set<string>();
    records.forEach((r) => s.add(r.type));
    return Array.from(s).sort();
  }, [records]);

  const statusOptions = useMemo(() => {
    const s = new Set<string>();
    records.forEach((r) => s.add(r.status));
    return Array.from(s).sort();
  }, [records]);

  const tagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    records.forEach((r) => {
      r.tags.forEach((t) => {
        const key = t.toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 30)
      .map(([t]) => t);
  }, [records]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.identifier.toLowerCase().includes(q)) {
        return false;
      }
      if (typeFilters.size > 0 && !typeFilters.has(r.type)) return false;
      if (statusFilters.size > 0 && !statusFilters.has(r.status)) return false;
      if (tagFilters.size > 0 && !r.tags.some((t) => tagFilters.has(t.toLowerCase()))) return false;
      return true;
    });
  }, [records, search, typeFilters, statusFilters, tagFilters]);

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
        <p className="mt-1 text-sm text-ink-medium max-w-3xl">
          Browse the secure directory of verified agent registries indexed by NANDA.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <FilterSidebar
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          typeOptions={typeOptions}
          typeFilters={typeFilters}
          onToggleType={(v) => toggle(typeFilters, v, setTypeFilters)}
          statusOptions={statusOptions}
          statusFilters={statusFilters}
          onToggleStatus={(v) => toggle(statusFilters, v, setStatusFilters)}
          tagOptions={tagOptions}
          tagFilters={tagFilters}
          onToggleTag={(v) => toggle(tagFilters, v, setTagFilters)}
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
          ) : records.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="bg-surface-light rounded-card border border-line/70 shadow-card p-6 max-w-md text-center">
                <p className="text-sm text-ink-medium">No org/registrys registered yet.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {pageItems.map((item) => (
                  <RegistryCard key={item.id} item={item} />
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
    </main>
  );
}

function FilterSidebar(props: {
  search: string;
  onSearchChange: (v: string) => void;
  typeOptions: string[];
  typeFilters: Set<string>;
  onToggleType: (v: string) => void;
  statusOptions: string[];
  statusFilters: Set<string>;
  onToggleStatus: (v: string) => void;
  tagOptions: string[];
  tagFilters: Set<string>;
  onToggleTag: (v: string) => void;
}) {
  return (
    <aside className="lg:w-64 flex-shrink-0">
      <div className="bg-surface-strong rounded-card border border-line p-4 space-y-5 sticky top-24 max-h-[calc(100vh-7rem)] flex flex-col overflow-hidden">
        <div className="flex-shrink-0">
          <label
            htmlFor="search"
            className="block text-xs font-semibold uppercase tracking-wide text-ink-medium mb-1.5"
          >
            Search
          </label>
          <input
            type="text"
            id="search"
            placeholder="Filter by org or identifier..."
            value={props.search}
            onChange={(e) => props.onSearchChange(e.target.value)}
            className="w-full rounded-control border-2 border-line bg-surface-light px-3 py-2 text-sm text-ink placeholder:text-ink-weak focus:outline-none focus:border-brand-500"
          />
        </div>

        <div className="flex-shrink-0">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-medium mb-2">
            Type
          </span>
          <div className="space-y-1.5">
            {props.typeOptions.map((opt) => (
              <label key={opt} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={props.typeFilters.has(opt)}
                  onChange={() => props.onToggleType(opt)}
                  className="rounded border-line-strong text-brand-500 focus:ring-brand-500"
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex-shrink-0">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-medium mb-2">
            Status
          </span>
          <div className="space-y-1.5">
            {props.statusOptions.map((opt) => (
              <label key={opt} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={props.statusFilters.has(opt)}
                  onChange={() => props.onToggleStatus(opt)}
                  className="rounded border-line-strong text-brand-500 focus:ring-brand-500"
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-medium mb-2">
            Tags
          </span>
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {props.tagOptions.map((tag) => (
              <label key={tag} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={props.tagFilters.has(tag)}
                  onChange={() => props.onToggleTag(tag)}
                  className="rounded border-line-strong text-brand-500 focus:ring-brand-500"
                />
                <span className="truncate">{tag}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function RegistryCard({ item }: { item: Registry }) {
  return (
    <article
      className="bg-surface-light rounded-card border border-line/70 shadow-card p-4 hover:shadow-card-hover hover:border-line-strong transition cursor-pointer flex flex-col h-full gap-3"
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
          <div className="mt-0.5 text-xs text-ink-weak">
            Version {item.version} • {item.date}
          </div>
        </div>
        {item.typeBadge && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-[#fdeccc] text-[#8a5a06] flex-shrink-0">
            {item.typeBadge}
          </span>
        )}
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
              className={`min-w-9 h-9 px-2 text-sm font-medium rounded-full transition ${
                p === page ? "bg-brand-500 text-white" : "text-ink hover:bg-surface-strong"
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
