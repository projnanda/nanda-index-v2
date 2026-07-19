import { describe, it, expect, vi, afterEach } from 'vitest';
import type { LlmEnrichmentConfig } from '../../src/config/index.js';

const createMock = vi.fn();

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

const { generateRepresentativeQueries } = await import('../../src/services/llmEnrichment.js');

function cfg(overrides: Partial<LlmEnrichmentConfig> = {}): LlmEnrichmentConfig {
  return { apiKey: 'sk-test', model: 'gpt-4o-mini', timeoutMs: 5000, ...overrides };
}

afterEach(() => {
  createMock.mockReset();
});

describe('generateRepresentativeQueries', () => {
  it('returns [] immediately when no API key is configured, without calling OpenAI', async () => {
    const result = await generateRepresentativeQueries(
      { displayName: 'Acme', description: 'Widgets', tags: ['widgets'] },
      cfg({ apiKey: undefined }),
    );
    expect(result).toEqual([]);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('parses representative queries from a well-formed response', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ queries: ['help me bake bread', 'find a bakery'] }) } }],
    });

    const result = await generateRepresentativeQueries(
      { displayName: 'Moonbakery', description: 'Order fresh bread', tags: ['bakery', 'bread'] },
      cfg(),
    );

    expect(result).toEqual(['help me bake bread', 'find a bakery']);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini', response_format: { type: 'json_object' } }),
    );
  });

  it('caps results at 5 queries', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ queries: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }) } }],
    });

    const result = await generateRepresentativeQueries(
      { displayName: 'X', description: null, tags: [] },
      cfg(),
    );
    expect(result).toHaveLength(5);
  });

  it('filters out non-string and empty entries', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ queries: ['good query', '', '   ', 42, null] }) } }],
    });

    const result = await generateRepresentativeQueries(
      { displayName: 'X', description: null, tags: [] },
      cfg(),
    );
    expect(result).toEqual(['good query']);
  });

  it('returns [] when the response content is not valid JSON', async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: 'not json' } }] });
    const result = await generateRepresentativeQueries(
      { displayName: 'X', description: null, tags: [] },
      cfg(),
    );
    expect(result).toEqual([]);
  });

  it('returns [] when the JSON shape is missing "queries"', async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ oops: true }) } }] });
    const result = await generateRepresentativeQueries(
      { displayName: 'X', description: null, tags: [] },
      cfg(),
    );
    expect(result).toEqual([]);
  });

  it('returns [] when the OpenAI call throws (network error, timeout, rate limit, etc.)', async () => {
    createMock.mockRejectedValue(new Error('network error'));
    const result = await generateRepresentativeQueries(
      { displayName: 'X', description: null, tags: [] },
      cfg(),
    );
    expect(result).toEqual([]);
  });

  it('returns [] when the response has no message content at all', async () => {
    createMock.mockResolvedValue({ choices: [{ message: {} }] });
    const result = await generateRepresentativeQueries(
      { displayName: 'X', description: null, tags: [] },
      cfg(),
    );
    expect(result).toEqual([]);
  });
});
