import { useState } from "react";
import type { AgentCandidate } from "@/lib/nanda-types";
import { ApiError, fetchFactsUrl } from "@/lib/nanda-api";
import { JsonPanel } from "@/components/JsonPanel";

const BASIS_LABEL: Record<AgentCandidate["provenance"]["basis"], string> = {
  agent_search: "enterprise registry",
  single_agent_org: "direct card",
  federated: "federated (ora.ai)",
};

export function AgentCandidateCard({
  candidate,
  best = false,
}: {
  candidate: AgentCandidate;
  best?: boolean;
}) {
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<unknown>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  async function handleResolve() {
    setResolving(true);
    setResolveError(null);
    setResolved(null);
    try {
      const data = await fetchFactsUrl(candidate.url);
      setResolved(data);
    } catch (err) {
      setResolveError(
        err instanceof ApiError
          ? `${candidate.url} returned ${err.status}: ${err.message}`
          : `Could not reach ${candidate.url} (network error or CORS).`,
      );
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface-light p-4 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-ink-strong">{candidate.display_name}</p>
            {best && (
              <span className="brand-tag rounded-full bg-brand-500 px-2.5 py-0.5 uppercase text-on-brand">
                Best match
              </span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-xs text-ink-medium">{candidate.identifier}</p>
          {candidate.description && (
            <p className="mt-1 text-sm text-ink-medium">{candidate.description}</p>
          )}
          <a
            href={candidate.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block truncate font-mono text-xs text-ink-strong hover:underline"
          >
            {candidate.url}
          </a>
          {candidate.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {candidate.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-line bg-surface-strong px-2.5 py-1 font-mono text-xs text-ink-medium"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right text-xs text-ink-weak">
          <p>score {candidate.score.toFixed(2)}</p>
          <p className="mt-0.5">{BASIS_LABEL[candidate.provenance.basis]}</p>
          <p className="mt-0.5 font-mono">{candidate.provenance.org_id}</p>
          <button
            type="button"
            onClick={handleResolve}
            disabled={resolving}
            className="mt-2 rounded-full border border-brand-800 bg-brand-800 px-3 py-1 text-xs font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {resolving ? "Resolving…" : "Resolve"}
          </button>
        </div>
      </div>

      {resolveError && (
        <div className="mt-3 rounded-2xl border border-brand-300 bg-warning-soft px-4 py-3 text-sm text-warning">
          {resolveError}
        </div>
      )}
      {resolved !== null && (
        <div className="mt-3">
          <JsonPanel data={resolved} />
        </div>
      )}
    </div>
  );
}
