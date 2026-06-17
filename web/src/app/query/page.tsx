"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { StatusBadge } from "@/components/StatusBadge";
import { JsonPanel } from "@/components/JsonPanel";
import { TableEmptyState } from "@/components/TableEmptyState";
import { ApiError, getIndexRecord, searchIndexRecords, resolveAgent, fetchAgentRecord } from "@/lib/nanda-api";
import type { IndexRecord, SearchResponse, ResolveResponse, CatalogEntry } from "@/lib/nanda-types";

// Matches urn:<nid>:<domain>:<identifier>
const URN_RE = /^urn:[a-z0-9][a-z0-9-]{0,30}:[^:]+:[^:]+$/i;

type Mode = "org_id" | "search";
type ResultKind = "single" | "search" | "resolve";

interface QueryResult {
  kind: ResultKind;
  single?: IndexRecord;
  search?: SearchResponse;
  resolve?: ResolveResponse;
  agent?: CatalogEntry | null;   // hop-2 agent record for URN queries
  agentError?: string;
}

function IndexRecordCard({ org }: { org: IndexRecord }) {
  const router = useRouter();
  return (
    <div
      className="flex cursor-pointer items-start justify-between rounded-2xl border border-black/10 bg-white p-4 shadow-sm transition hover:shadow-md"
      onClick={() => router.push(`/registries`)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-slate-950">{org.display_name}</p>
          <StatusBadge status={org.status} />
        </div>
        <p className="mt-0.5 font-mono text-xs text-slate-500">{org.org_id}</p>
        <p className="mt-1 text-sm text-slate-600">{org.domain}</p>
        {org.registry_url && (
          <p className="mt-0.5 truncate font-mono text-xs text-slate-400">{org.registry_url}</p>
        )}
      </div>
      <div className="ml-4 shrink-0 text-right text-xs text-slate-400">
        TTL {org.ttl_seconds}s
        {org.email_verified && (
          <span className="ml-2 text-emerald-600">✓ verified</span>
        )}
      </div>
    </div>
  );
}

export default function QueryPage() {
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect whether input looks like a URN — affects placeholder and routing
  const isUrn = URN_RE.test(query.trim());

  async function runQuery(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setResult(null);
    const t0 = performance.now();

    try {
      // URN input — hop 1: NANDA Index resolve, hop 2: fetch agent from registry
      if (URN_RE.test(q)) {
        const indexData = await resolveAgent(q);
        let agent = null;
        let agentError: string | undefined;
        if (!indexData.index_record.registry_url) {
          agentError = "This entry has no registry URL (DNS-AID or custom discovery).";
        } else {
          try {
            agent = await fetchAgentRecord(
              indexData.index_record.registry_url,
              indexData.identifier,
              indexData.index_record.media_type,
            );
          } catch (err) {
            agentError = err instanceof ApiError
              ? `Registry returned ${err.status}: ${err.message}`
              : "Could not reach the registry server.";
          }
        }
        setResult({ kind: "resolve", resolve: indexData, agent, agentError });
      } else if (mode === "org_id") {
        const data = await getIndexRecord(q);
        setResult({ kind: "single", single: data });
      } else {
        const data = await searchIndexRecords(q);
        setResult({ kind: "search", search: data });
      }
      setLatency(Math.round(performance.now() - t0));
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.status}: ${err.message}`);
      else setError("Query failed — check your input and try again.");
      setLatency(Math.round(performance.now() - t0));
    } finally {
      setLoading(false);
    }
  }

  const placeholder =
    isUrn
      ? "URN detected — will resolve via NANDA Index"
      : mode === "org_id"
      ? "nasiko"
      : "moonbakery  or  urn:ai:moonbakery.com:order";

  return (
    <PageShell
      title="Index Query"
      description="Look up an organization by org ID, keyword, or URN agent locator."
    >
      <form
        className="space-y-4 rounded-3xl border border-black/10 bg-white p-5 shadow-sm"
        onSubmit={runQuery}
      >
        {/* Mode selector — hidden when URN is detected */}
        {!isUrn && (
          <div className="flex flex-wrap gap-2">
            {(["search", "org_id"] as Mode[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  mode === key
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-black/10 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {key === "org_id" ? "By Org ID" : "Keyword Search"}
              </button>
            ))}
          </div>
        )}

        {/* URN hint */}
        {isUrn && (
          <p className="text-xs text-indigo-600">
            URN detected — resolving via NANDA Index
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="rounded-2xl border border-black/10 px-4 py-3 font-mono text-sm outline-none focus:ring-2 focus:ring-slate-300"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Running…" : "Run"}
          </button>
        </div>

        {latency !== null && (
          <p className="text-xs text-slate-400">Latency: {latency} ms</p>
        )}
      </form>

      <div className="mt-6 space-y-4">
        {error && (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* Single org result */}
        {result?.kind === "single" && result.single && (
          <>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              Index record
            </p>
            <IndexRecordCard org={result.single} />
            <JsonPanel data={result.single} />
          </>
        )}

        {/* Search results */}
        {result?.kind === "search" && result.search && (
          <>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              {result.search.count === 0
                ? "No results"
                : `${result.search.count} result${result.search.count !== 1 ? "s" : ""} for "${result.search.query}"`}
            </p>
            {result.search.results.length === 0 ? (
              <TableEmptyState
                title="No organizations found"
                description={`No active organizations match "${result.search.query}".`}
              />
            ) : (
              <div className="space-y-2">
                {result.search.results.map((org) => (
                  <IndexRecordCard key={org.org_id} org={org} />
                ))}
              </div>
            )}
            <JsonPanel data={result.search} />
          </>
        )}

        {/* URN resolve result — hop 1 (index) + hop 2 (agent record) */}
        {result?.kind === "resolve" && result.resolve && (
          <>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              Resolved — <span className="font-mono normal-case">{result.resolve.locator}</span>
            </p>

            {/* Hop 1 — NANDA Index record */}
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
                Hop 1 — NANDA Index
              </p>
              <IndexRecordCard org={result.resolve.index_record} />
            </div>

            {/* Hop 2 — Agent record from the registry server */}
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
                Hop 2 — Agent record
              </p>
              {result.agentError ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  {result.agentError}
                </div>
              ) : result.agent ? (
                <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-950">{result.agent.displayName}</p>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-mono text-[11px] text-emerald-700">
                      {result.agent.identifier}
                    </span>
                  </div>
                  {result.agent.description && (
                    <p className="text-sm text-slate-600">{result.agent.description}</p>
                  )}
                  <a href={result.agent.url} target="_blank" rel="noopener noreferrer"
                    className="block truncate font-mono text-xs text-indigo-600 hover:underline">
                    {result.agent.url}
                  </a>
                  {(result.agent.tags ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {(result.agent.tags ?? []).map((tag) => (
                        <span key={tag} className="rounded-full border border-black/10 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-600">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <JsonPanel data={{ hop1_index: result.resolve, hop2_agent: result.agent }} />
          </>
        )}

        {/* Empty state */}
        {!result && !error && (
          <TableEmptyState
            title="No query yet"
            description='Try "nasiko", a keyword, or a full URN like "urn:ai:moonbakery.com:order".'
          />
        )}
      </div>
    </PageShell>
  );
}
