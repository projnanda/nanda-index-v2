import type { ReactNode } from "react";
import type { IndexRecord } from "@/lib/nanda-types";
import {
  dataEntries,
  humanize,
  metaString,
  projectNandaMeta,
  resolutionHeadline,
  roleLabel,
  targetLabel,
} from "@/lib/resolution";

// Keys surfaced explicitly in the Target / routing section, so they are not
// repeated in the catch-all Metadata table below.
const SURFACED_META_KEYS = [
  "preferredDiscovery",
  "resolutionRole",
  "runtime.provider",
  "runtime.url",
  "auth.metadata",
  "auth.execution",
  "agentCardHost",
] as const;

/**
 * Structured detail body for an index entry, presented as a NandaIndex
 * resolution record: how it resolves, who published it (and what is verified),
 * what it targets, and the remaining routing metadata.
 */
export function RecordDetails({ record }: { record: IndexRecord }) {
  const role = roleLabel(metaString(record, "resolutionRole"));
  const runtimeProvider = metaString(record, "runtime.provider");
  const runtimeUrl = metaString(record, "runtime.url");
  const authMetadata = metaString(record, "auth.metadata");
  const authExecution = metaString(record, "auth.execution");
  const cardHost = metaString(record, "agentCardHost");
  const dnsData = dataEntries(record);
  const extraMeta = projectNandaMeta(record, SURFACED_META_KEYS);
  const hasOverview = !!record.domain || !!record.description || (record.tags?.length ?? 0) > 0;

  return (
    <div className="bg-surface-light rounded-card border border-line p-5 shadow-card space-y-4">
      {hasOverview && (
        <div>
          {record.domain && <p className="text-sm text-ink-medium break-all">{record.domain}</p>}
          {record.description && (
            <p className="mt-2 text-sm leading-relaxed text-ink-medium">{record.description}</p>
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
        </div>
      )}

      <Section title="Resolution">
        <DetailRow label="Resolves via">
          <span className="font-semibold">{resolutionHeadline(record)}</span>
        </DetailRow>
        {role && <DetailRow label="Role">{role}</DetailRow>}
      </Section>

      <Section title="Publisher / verification">
        {record.publisher ? (
          <>
            <DetailRow label="Publisher">
              {record.publisher.displayName}
              {record.publisher.identityType ? ` (${record.publisher.identityType})` : ""}
            </DetailRow>
            <DetailRow label="Identifier">
              <span className="font-mono text-xs break-all">{record.publisher.identifier}</span>
            </DetailRow>
          </>
        ) : (
          <DetailRow label="Publisher">
            <span className="text-ink-weak">-</span>
          </DetailRow>
        )}
        <DetailRow label="Email verified">
          <VerifiedChip ok={record.email_verified} />
        </DetailRow>
        <DetailRow label="Domain verified">
          <VerifiedChip ok={record.domain_verified} />
        </DetailRow>
      </Section>

      <Section title="Target / routing">
        {record.registry_url ? (
          <DetailRow label={targetLabel(record.media_type)}>
            <a
              href={record.registry_url}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-mono text-xs text-brand-600 hover:underline"
            >
              {record.registry_url}
            </a>
          </DetailRow>
        ) : (
          dnsData.length === 0 && (
            <DetailRow label={targetLabel(record.media_type)}>
              <span className="text-ink-weak">-</span>
            </DetailRow>
          )
        )}
        {dnsData.map((entry) => (
          <DetailRow key={entry.key} label={entry.label}>
            <span className="font-mono text-xs break-all">{entry.value}</span>
          </DetailRow>
        ))}
        {(runtimeProvider || runtimeUrl) && (
          <DetailRow label="Runtime">
            {runtimeProvider && <span>{runtimeProvider}</span>}
            {runtimeUrl && (
              <>
                {runtimeProvider ? " — " : null}
                <a
                  href={runtimeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-mono text-xs text-brand-600 hover:underline"
                >
                  {runtimeUrl}
                </a>
              </>
            )}
          </DetailRow>
        )}
        {cardHost && <DetailRow label="Card host">{cardHost}</DetailRow>}
        {authMetadata && <DetailRow label="Auth (metadata)">{humanize(authMetadata)}</DetailRow>}
        {authExecution && <DetailRow label="Auth (execution)">{humanize(authExecution)}</DetailRow>}
        <DetailRow label="Media type">
          <span className="font-mono text-xs">{record.media_type ?? "-"}</span>
        </DetailRow>
        <DetailRow label="TTL">{record.ttl_seconds}s</DetailRow>
        <DetailRow label="Status">
          <span className="capitalize">{record.status}</span>
        </DetailRow>
        <DetailRow label="Created">{new Date(record.created_at).toLocaleDateString()}</DetailRow>
      </Section>

      {extraMeta.length > 0 && (
        <Section title="Metadata">
          {extraMeta.map((entry) => (
            <DetailRow key={entry.key} label={entry.label}>
              <span className="break-words">{entry.value}</span>
            </DetailRow>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-weak">{title}</h3>
      <dl className="grid gap-2 text-sm text-ink">{children}</dl>
    </section>
  );
}

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="font-semibold text-ink-strong flex-shrink-0">{label}:</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function VerifiedChip({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
        ok ? "bg-[#dcf5e6] text-[#0f7a45]" : "bg-surface-tag text-ink-weak"
      }`}
    >
      {ok ? "Yes" : "No"}
    </span>
  );
}
