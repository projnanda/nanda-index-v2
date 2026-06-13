"use client";

import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { JsonPanel } from "@/components/JsonPanel";
import { TableEmptyState } from "@/components/TableEmptyState";
import { ApiError, resolveAgent, fetchAgentRecord } from "@/lib/nanda-api";
import type { ResolveResponse, CatalogEntry } from "@/lib/nanda-types";

function IndexRecordPanel({ result }: { result: ResolveResponse }) {
  const { index_record } = result;
  return (
    <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
      <p className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
        Step 1 — NANDA Index → {index_record.org_id}
      </p>
      <div className="grid gap-2 text-sm text-slate-700">
        <div>
          <span className="font-medium">Org:</span> {index_record.display_name}
        </div>
        <div>
          <span className="font-medium">Domain:</span> {index_record.domain}
        </div>
        <div>
          <span className="font-medium">Registry URL:</span>{" "}
          <span className="font-mono text-xs">{index_record.registry_url}</span>
        </div>
        <div>
          <span className="font-medium">TTL:</span> {index_record.ttl_seconds}s
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Next: <span className="font-mono">{index_record.registry_url}/agents/{result.identifier}</span>
      </p>
    </div>
  );
}

function AgentRecordPanel({ agent }: { agent: CatalogEntry }) {
  return (
    <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
      <p className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
        Step 2 — Registry Server → {agent.identifier}
      </p>
      <div className="grid gap-2 text-sm text-slate-700">
        <div>
          <span className="font-medium">Display name:</span> {agent.displayName}
        </div>
        {agent.description && (
          <div>
            <span className="font-medium">Description:</span> {agent.description}
          </div>
        )}
        <div>
          <span className="font-medium">URL:</span>{" "}
          <a
            href={agent.url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all font-mono text-xs text-indigo-600 underline-offset-2 hover:underline"
          >
            {agent.url}
          </a>
        </div>
        <div>
          <span className="font-medium">Media type:</span>{" "}
          <span className="font-mono text-xs">{agent.mediaType}</span>
        </div>
        {agent.tags && agent.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {agent.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-black/10 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-700"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ResolvePage() {
  const [identifier, setIdentifier] = useState("");
  const [indexResult, setIndexResult] = useState<ResolveResponse | null>(null);
  const [agentResult, setAgentResult] = useState<CatalogEntry | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  async function onResolve(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!identifier.trim()) return;

    const locator = identifier.trim();
    setLoading(true);
    setError(null);
    setIndexResult(null);
    setAgentResult(null);
    setAgentError(null);
    const t0 = performance.now();

    try {
      // Hop 1: NANDA Index lookup
      const indexData = await resolveAgent(locator);
      setIndexResult(indexData);

      // Hop 2: caller fetches AgentRecord directly from the registry
      if (!indexData.index_record.registry_url) {
        setAgentError("This entry has no registry URL (DNS-AID or custom discovery).");
      } else {
        try {
          const agentData = await fetchAgentRecord(
            indexData.index_record.registry_url,
            indexData.identifier,
          );
          setAgentResult(agentData);
        } catch (err) {
          if (err instanceof ApiError) {
            setAgentError(`Registry returned ${err.status}: ${err.message}`);
          } else {
            setAgentError("Could not reach the registry server.");
          }
        }
      }

      setLatency(Math.round(performance.now() - t0));
    } catch (err) {
      setLatency(Math.round(performance.now() - t0));
      if (err instanceof ApiError) {
        setError(`${err.status}: ${err.message}`);
      } else {
        setError("Resolution failed — check the locator format and try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell
      title="Resolve Agent"
      description="Enter a URN locator (urn:ai:domain.com:agent) to look up the agent's registry entry."
    >
      <form
        onSubmit={onResolve}
        className="mb-6 rounded-3xl border border-black/10 bg-white p-5 shadow-sm space-y-4"
        suppressHydrationWarning
      >
        <p className="text-xs text-slate-500">
          Two-hop resolution: NANDA Index → org's Registry Server → A2A card.
        </p>

        <div className="flex gap-3">
          <div className="flex flex-1 items-center overflow-hidden rounded-2xl border border-black/10 bg-white focus-within:ring-2 focus-within:ring-slate-300">
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="urn:ai:domain.com:agent"
              className="flex-1 bg-transparent px-4 py-3 outline-none font-mono text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !identifier.trim()}
            className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Resolving…" : "Resolve"}
          </button>
        </div>

        {latency !== null && (
          <p className="text-xs text-slate-400">Resolved in {latency} ms</p>
        )}
      </form>

      {error && (
        <div className="mb-6 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      {indexResult ? (
        <div className="space-y-5">
          <IndexRecordPanel result={indexResult} />

          {agentError && (
            <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {agentError}
            </div>
          )}

          {agentResult && <AgentRecordPanel agent={agentResult} />}

          <JsonPanel data={{ index: indexResult, agent: agentResult }} />
        </div>
      ) : (
        !error && (
          <TableEmptyState
            title="No resolution yet"
            description='Enter a URN like "urn:ai:nasiko.com:ankit" and click Resolve.'
          />
        )
      )}
    </PageShell>
  );
}
