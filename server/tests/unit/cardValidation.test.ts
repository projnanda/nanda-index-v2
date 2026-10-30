import { describe, expect, it, vi } from 'vitest';
import { validateRegistrationCard } from '../../src/services/cardValidation.js';
import { publicUrlGuardWith, type UrlGuard } from '../../src/lib/outboundUrl.js';
const card = { name: 'Example', description: 'A demo', version: '1', url: 'https://example.org/run', capabilities: {}, skills: [], defaultInputModes: ['text'], defaultOutputModes: ['text'] };
const guard = (body: unknown, status = 200): UrlGuard => async () => async () => new Response(JSON.stringify(body), { status });
const type = 'application/a2a-agent-card+json';
describe('registration card validation', () => {
  it('fetches the card and records a bounded structural check with a timestamp', async () => {
    const result = await validateRegistrationCard('https://example.org/card.json', type, { guard: guard(card) });
    expect(result.status).toBe('valid');
    expect(result.checkedAt).toMatch(/^\d{4}-/);
  });
  it.each([{}, [], { ...card, skills: 'no' }, { ...card, url: 'javascript:alert(1)' }])('rejects malformed card shapes', async (body) => {
    expect((await validateRegistrationCard('https://example.org/card.json', type, { guard: guard(body) })).status).toBe('invalid');
  });
  it('reports HTTP failure without pretending the endpoint is down', async () => {
    expect(await validateRegistrationCard('https://example.org/card.json', type, { guard: guard({}, 404) })).toMatchObject({ status: 'unavailable', detail: 'Card request returned HTTP 404.' });
  });
  it('refuses private destinations before connecting', async () => {
    const lookup = vi.fn().mockResolvedValue(['127.0.0.1']);
    expect((await validateRegistrationCard('https://example.org/card.json', type, { guard: publicUrlGuardWith(lookup) })).status).toBe('unavailable');
  });
  it('uses redirect:error and an abort signal', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(card)));
    await validateRegistrationCard('https://example.org/card.json', type, { guard: async () => fetch });
    expect(fetch).toHaveBeenCalledWith('https://example.org/card.json', expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));
  });
  it('bounds DNS/guard delays as well as response fetches', async () => {
    const result = await validateRegistrationCard('https://example.org/card.json', type, { guard: () => new Promise(() => {}), timeoutMs: 10 });
    expect(result.status).toBe('unavailable');
  });
  it('refuses oversized and non-JSON responses', async () => {
    expect((await validateRegistrationCard('https://example.org/card.json', type, { guard: async () => async () => new Response('x'.repeat(300_000)) })).status).toBe('invalid');
  });
  it('does not fetch unsupported artifact types', async () => {
    const check = vi.fn();
    expect((await validateRegistrationCard('https://example.org/skill.zip', 'application/agentskill+zip', { guard: check })).status).toBe('not_checked');
    expect(check).not.toHaveBeenCalled();
  });
});
it('accepts modern A2A interfaces without treating them as URLs to fetch', async () => {
  const body = { ...card, url: undefined, supportedInterfaces: [{ url: 'https://example.org/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }] };
  expect((await validateRegistrationCard('https://example.org/card.json', type, { guard: guard(body) })).status).toBe('valid');
});
it('checks required MCP server card fields', async () => {
  const body = { $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json', name: 'org.example/demo', version: '1.0.0', description: 'Demo', remotes: [{ type: 'streamable-http', url: 'https://example.org/mcp' }] };
  expect((await validateRegistrationCard('https://example.org/card.json', 'application/mcp-server-card+json', { guard: guard(body) })).status).toBe('valid');
  expect((await validateRegistrationCard('https://example.org/card.json', 'application/mcp-server-card+json', { guard: guard({ ...body, remotes: 'bad' }) })).status).toBe('invalid');
});
