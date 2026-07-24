"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { StatusBadge } from "@/components/StatusBadge";
import { JsonPanel } from "@/components/JsonPanel";
import { TableEmptyState } from "@/components/TableEmptyState";
import { AgentCandidateCard } from "@/components/AgentCandidateCard";
import { ApiError, getIndexRecord, searchIndexRecords, resolveAgent, fetchAgentRecord, agenticSearch } from "@/lib/nanda-api";
import type { IndexRecord, SearchResponse, ResolveResponse, CatalogEntry, AgenticSearchResponse } from "@/lib/nanda-types";

// Matches urn:<nid>:<domain>:<identifier>
const URN_RE = /^urn:[a-z0-9][a-z0-9-]{0,30}:[^:]+:[^:]+$/i;

type Mode = "org_id" | "search" | "agentic";
type ResultKind = "single" | "search" | "resolve" | "agentic";

interface QueryResult {
  kind: ResultKind;
  single?: IndexRecord;
  search?: SearchResponse;
  resolve?: ResolveResponse;
  agent?: CatalogEntry | null;   // hop-2 agent record for URN queries
  agentError?: string;
  agentic?: AgenticSearchResponse;
}

function IndexRecordCard({ org }: { org: IndexRecord }) {
  const router = useRouter();
  return (
    <div
      className="flex cursor-pointer items-start justify-between rounded-2xl border border-line bg-surface-light p-4 shadow-sm transition hover:shadow-md"
      onClick={() => router.push(`/`)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-ink-strong">{org.display_name}</p>
          <StatusBadge status={org.status} />
        </div>
        <p className="mt-0.5 font-mono text-xs text-ink-medium">{org.org_id}</p>
        <p className="mt-1 text-sm text-ink-medium">{org.domain}</p>
        {org.registry_url && (
          <p className="mt-0.5 truncate font-mono text-xs text-ink-weak">{org.registry_url}</p>
        )}
      </div>
      <div className="ml-4 shrink-0 text-right text-xs text-ink-weak">
        TTL {org.ttl_seconds}s
        {org.domain_verified && (
          <span className="ml-2 text-success">✓ verified</span>
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

  // Detect whether input looks like a URN, which affects the placeholder and routing
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
      // URN input: hop 1 resolves via NANDA Index, hop 2 fetches the agent from the registry
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
      } else if (mode === "agentic") {
        const data = await agenticSearch(q);
        setResult({ kind: "agentic", agentic: data });
      } else {
        const data = await searchIndexRecords(q);
        setResult({ kind: "search", search: data });
      }
      setLatency(Math.round(performance.now() - t0));
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.status}: ${err.message}`);
      else setError("Query failed. Check your input and try again.");
      setLatency(Math.round(performance.now() - t0));
    } finally {
      setLoading(false);
    }
  }

  const placeholder =
    isUrn
      ? "URN detected. Will resolve via NANDA Index"
      : mode === "org_id"
        ? "moonbakery39"
        : mode === "agentic"
          ? "Help me place an order for a custom cake"
          : "moonbakery39  or  urn:ai:moonbakery39.com:order";

  return (
    <PageShell
      title="Discover"
      description="Look up an organization by org ID, keyword, URN, or a natural-language prompt."
    >
      <form
        className="space-y-4 rounded-3xl border border-line bg-surface-light p-5 shadow-sm"
        onSubmit={runQuery}
      >
        {/* Mode selector, hidden when URN is detected */}
        {!isUrn && (
          <div className="flex flex-wrap gap-2">
            {(["agentic", "search", "org_id"] as Mode[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={`rounded-full border px-4 py-2 text-sm transition ${mode === key
                  ? "border-brand-800 bg-brand-800 text-white"
                  : "border-line bg-surface-light text-ink-medium hover:bg-surface-strong"
                  }`}
              >
                {key === "org_id" ? "By Org ID" : key === "agentic" ? "Agentic Search" : "Keyword Search"}
              </button>
            ))}
          </div>
        )}

        {/* URN hint */}
        {isUrn && (
          <p className="text-xs text-ink-strong">
            URN detected. Resolving via NANDA Index
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="rounded-2xl border border-line px-4 py-3 font-mono text-sm outline-none focus:ring-2 focus:ring-line-strong"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded-2xl bg-brand-500 px-5 py-3 text-sm font-medium text-on-brand hover:bg-brand-600 transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Running…" : "Run"}
          </button>
        </div>

        {latency !== null && (
          <p className="text-xs text-ink-weak">Latency: {latency} ms</p>
        )}
      </form>

      <div className="mt-6 space-y-4">
        {error && (
          <div className="rounded-3xl border border-danger bg-danger-soft p-4 text-sm text-danger">
            {error}
          </div>
        )}

        {/* Single org result */}
        {result?.kind === "single" && result.single && (
          <>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-medium">
              Index record
            </p>
            <IndexRecordCard org={result.single} />
            <JsonPanel data={result.single} />
          </>
        )}

        {/* Search results */}
        {result?.kind === "search" && result.search && (
          <>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-medium">
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

        {/* Agentic search results: ranked agent candidates */}
        {result?.kind === "agentic" && result.agentic && (
          <>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-medium">
              {result.agentic.count === 0
                ? "No candidates"
                : `${result.agentic.count} candidate${result.agentic.count !== 1 ? "s" : ""} for "${result.agentic.query}"`}
              <span className="ml-2 normal-case text-ink-weak">
                ({result.agentic.orgs_queried} org{result.agentic.orgs_queried !== 1 ? "s" : ""} queried, {result.agentic.took_ms}ms)
              </span>
            </p>
            {result.agentic.orgs_unreachable.length > 0 && (
              <div className="rounded-2xl border border-brand-300 bg-warning-soft px-4 py-3 text-sm text-warning">
                Unreachable: {result.agentic.orgs_unreachable.join(", ")}
              </div>
            )}
            {result.agentic.candidates.length === 0 ? (
              <TableEmptyState
                title="No agent candidates found"
                description={`No active agents match "${result.agentic.query}".`}
              />
            ) : (
              <div className="space-y-2">
                {result.agentic.candidates.map((candidate) => (
                  <AgentCandidateCard
                    key={candidate.identifier}
                    candidate={candidate}
                    best={candidate.identifier === result.agentic!.resolved?.identifier}
                  />
                ))}
              </div>
            )}
            <JsonPanel data={result.agentic} />
          </>
        )}

        {/* URN resolve result: hop 1 (index) plus hop 2 (agent record) */}
        {result?.kind === "resolve" && result.resolve && (
          <>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-medium">
              Resolved: <span className="font-mono normal-case">{result.resolve.locator}</span>
            </p>

            {/* Hop 1: NANDA Index record */}
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-ink-weak">
                Hop 1: NANDA Index
              </p>
              <IndexRecordCard org={result.resolve.index_record} />
            </div>

            {/* Hop 2: Agent record from the registry server */}
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-ink-weak">
                Hop 2: Agent record
              </p>
              {result.agentError ? (
                <div className="rounded-2xl border border-brand-300 bg-warning-soft px-4 py-3 text-sm text-warning">
                  {result.agentError}
                </div>
              ) : result.agent ? (
                <div className="rounded-2xl border border-line bg-surface-light p-4 shadow-sm space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-ink-strong">{result.agent.displayName}</p>
                    <span className="rounded-full border border-line bg-success-soft px-2.5 py-0.5 font-mono text-[11px] text-success">
                      {result.agent.identifier}
                    </span>
                  </div>
                  {result.agent.description && (
                    <p className="text-sm text-ink-medium">{result.agent.description}</p>
                  )}
                  <a href={result.agent.url} target="_blank" rel="noopener noreferrer"
                    className="block truncate font-mono text-xs text-ink-strong hover:underline">
                    {result.agent.url}
                  </a>
                  {(result.agent.tags ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {(result.agent.tags ?? []).map((tag) => (
                        <span key={tag} className="rounded-full border border-line bg-surface-strong px-2.5 py-1 font-mono text-xs text-ink-medium">
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
            description='Try keyword, or a full URN like "urn:ai:moonbakery.com:order".'
          />
        )}
      </div>
    </PageShell>
  );
}
