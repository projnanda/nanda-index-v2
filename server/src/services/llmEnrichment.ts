import OpenAI from 'openai';
import type { LlmEnrichmentConfig } from '../config/index.js';

export interface OrgEnrichmentInput {
  displayName: string;
  description: string | null;
  tags: string[];
}

const MAX_QUERIES = 5;

function buildPrompt(org: OrgEnrichmentInput): string {
  return [
    `Organization: ${org.displayName}`,
    `Description: ${org.description ?? '(none)'}`,
    `Tags: ${org.tags.length > 0 ? org.tags.join(', ') : '(none)'}`,
    '',
    `Generate up to ${MAX_QUERIES} short, natural-language task requests a user might type ` +
      'when looking for an agent that does what this organization does — e.g. "help me send a ' +
      'transactional email" rather than "email API". Use everyday phrasing, not the organization\'s ' +
      'own jargon. Respond with a JSON object: {"queries": string[]}.',
  ].join('\n');
}

function isQueriesPayload(body: unknown): body is { queries: unknown[] } {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { queries?: unknown }).queries)
  );
}

/**
 * Generates representative natural-language task phrasings for an org, to
 * fold into search_vector alongside tags/description. This is the write-time
 * enrichment step — it runs once at org registration/update, not per search
 * query, so it adds no latency or cost to agentic search itself.
 *
 * Best-effort: returns [] (never throws) when no API key is configured, the
 * request times out, or the API errors — registration/update must never fail
 * because of this, and search quality without it is exactly today's baseline.
 */
export async function generateRepresentativeQueries(
  org: OrgEnrichmentInput,
  config: LlmEnrichmentConfig,
): Promise<string[]> {
  if (!config.apiKey) return [];

  const client = new OpenAI({ apiKey: config.apiKey, timeout: config.timeoutMs });

  try {
    const completion = await client.chat.completions.create({
      model: config.model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You generate short search-query phrasings for a directory of agent-ready organizations. Respond with JSON only.',
        },
        { role: 'user', content: buildPrompt(org) },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!isQueriesPayload(parsed)) return [];

    return parsed.queries
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .slice(0, MAX_QUERIES);
  } catch {
    return [];
  }
}
