import { publicUrlGuard, type UrlGuard } from '../lib/outboundUrl.js';
import { readCappedJson } from './remoteEntry.js';

export interface CardValidation {
  status: 'valid' | 'invalid' | 'unavailable' | 'not_checked';
  checkedAt: string | null;
  detail: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown): boolean { return typeof value === 'string' && value.trim().length > 0; }
function strings(value: unknown): boolean { return Array.isArray(value) && value.length > 0 && value.every(text); }
const coreBindings = new Set(['JSONRPC', 'GRPC', 'HTTP+JSON']);
function absoluteUrl(value: unknown): boolean {
  try { const url = new URL(typeof value === 'string' ? value : ''); return !url.username && !url.password; }
  catch { return false; }
}
function httpUrl(value: unknown): boolean {
  try {
    const url = new URL(typeof value === 'string' ? value : '');
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

/** A bounded check of required discovery fields, not protocol certification or a runtime probe.
 * A2A: https://a2a-protocol.org/latest/specification/#441-agentcard
 * MCP (experimental): https://github.com/modelcontextprotocol/ext-server-card
 */
function validShape(body: unknown, mediaType: string): boolean {
  if (!object(body) || !text(body.name) || !text(body.description) || !text(body.version)) return false;
  if (mediaType === 'application/a2a-agent-card+json') {
    const interfaces = body.supportedInterfaces;
    const endpoint = interfaces !== undefined
      ? Array.isArray(interfaces) && interfaces.length > 0 && interfaces.every((item) => object(item) && text(item.protocolBinding) && text(item.protocolVersion) && (coreBindings.has(String(item.protocolBinding)) ? httpUrl(item.url) : absoluteUrl(item.url)))
      : httpUrl(body.url);
    return endpoint && object(body.capabilities) && strings(body.defaultInputModes) && strings(body.defaultOutputModes)
      && Array.isArray(body.skills) && body.skills.every((skill) => object(skill) && text(skill.id) && text(skill.name) && text(skill.description) && Array.isArray(skill.tags) && skill.tags.every(text));
  }
  return body.$schema === 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json'
    && /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(body.name as string)
    && (body.remotes === undefined || (Array.isArray(body.remotes) && body.remotes.every((remote) => object(remote) && ['streamable-http', 'sse'].includes(String(remote.type)) && httpUrl(remote.url))));
}

export async function validateRegistrationCard(
  url: string | null,
  mediaType: string,
  options: { guard?: UrlGuard; timeoutMs?: number } = {},
): Promise<CardValidation> {
  if (!['application/a2a-agent-card+json', 'application/mcp-server-card+json'].includes(mediaType)) {
    return { status: 'not_checked', checkedAt: null, detail: 'Card checks apply to A2A and MCP JSON cards. This artifact type has not been checked.' };
  }
  const checkedAt = new Date().toISOString();
  const result = (status: CardValidation['status'], detail: string): CardValidation => ({ status, checkedAt, detail });
  if (!url || !httpUrl(url)) return result('invalid', 'Card URL must be HTTP or HTTPS without embedded credentials.');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const fetch = await (options.guard ?? publicUrlGuard)(url);
        // A timed-out DNS lookup must not start a connection later.
        controller.signal.throwIfAborted();
        const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
        if (!response.ok) return result('unavailable', `Card request returned HTTP ${response.status}.`);
        const body = await readCappedJson(response);
        if (!validShape(body, mediaType)) return result('invalid', 'Card is not valid JSON within 256 KiB or does not satisfy the required discovery-field checks.');
        if (mediaType === 'application/a2a-agent-card+json' && object(body) && Array.isArray(body.supportedInterfaces)
          && body.supportedInterfaces.some((item) => object(item) && !coreBindings.has(String(item.protocolBinding)))) {
          return result('not_checked', 'Card fetched, but a custom protocol binding is outside this checker’s supported scope. Its endpoint was not fetched or tested.');
        }
        return result('valid', 'Card fetched and required discovery fields passed structural checks. Runtime availability and optional protocol fields were not tested.');
      })(),
      new Promise<CardValidation>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(result('unavailable', 'Card check timed out. Endpoint availability is unknown.'));
        }, options.timeoutMs ?? 3000);
      }),
    ]);
  } catch {
    return result('unavailable', 'Card could not be fetched safely. The host may be unreachable or disallowed; endpoint availability is unknown.');
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}
