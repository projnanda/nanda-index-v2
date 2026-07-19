import type { AgentCandidate } from "@/lib/nanda-types";

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
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-950">{candidate.display_name}</p>
            {best && (
              <span className="rounded-full bg-accent-teal px-2.5 py-0.5 text-xs font-semibold text-accent-teal-ink">
                Best match
              </span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-xs text-slate-500">{candidate.identifier}</p>
          {candidate.description && (
            <p className="mt-1 text-sm text-slate-600">{candidate.description}</p>
          )}
          <a
            href={candidate.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block truncate font-mono text-xs text-indigo-600 hover:underline"
          >
            {candidate.url}
          </a>
          {candidate.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {candidate.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-black/10 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-600"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right text-xs text-slate-400">
          <p>score {candidate.score.toFixed(2)}</p>
          <p className="mt-0.5">{BASIS_LABEL[candidate.provenance.basis]}</p>
          <p className="mt-0.5 font-mono">{candidate.provenance.org_id}</p>
        </div>
      </div>
    </div>
  );
}
