import { publicUrlGuard, type UrlGuard } from '../lib/outboundUrl.js';
import { readCappedJson } from './remoteEntry.js';
import { JSON_CARD_MEDIA_TYPES, NANDA_MEDIA_TYPE } from '../lib/mediaTypes.js';

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
function discoveryFieldIssues(body: unknown, mediaType: string): string[] {
  if (!object(body)) return ['body (must be a JSON object)'];
  const issues = ['name', 'description', 'version'].filter((field) => !text(body[field]));
  if (mediaType === NANDA_MEDIA_TYPE.A2A_CARD) {
    const interfaces = body.supportedInterfaces;
    const endpoint = interfaces !== undefined
      ? Array.isArray(interfaces) && interfaces.length > 0 && interfaces.every((item) => object(item) && text(item.protocolBinding) && text(item.protocolVersion) && (coreBindings.has(String(item.protocolBinding)) ? httpUrl(item.url) : absoluteUrl(item.url)))
      : httpUrl(body.url);
    if (!endpoint) issues.push(interfaces !== undefined ? 'supportedInterfaces (each requires url, protocolBinding, and protocolVersion)' : 'url');
    if (!object(body.capabilities)) issues.push('capabilities');
    if (!strings(body.defaultInputModes)) issues.push('defaultInputModes');
    if (!strings(body.defaultOutputModes)) issues.push('defaultOutputModes');
    if (!(Array.isArray(body.skills) && body.skills.every((skill) => object(skill) && text(skill.id) && text(skill.name) && text(skill.description) && Array.isArray(skill.tags) && skill.tags.every(text)))) {
      issues.push('skills (each requires id, name, description, and tags)');
    }
    return issues;
  }
  if (body.$schema !== 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json') issues.push('$schema');
  if (text(body.name) && !/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(body.name as string)) issues.push('name (must use namespace/server form)');
  if (!(body.remotes === undefined || (Array.isArray(body.remotes) && body.remotes.every((remote) => object(remote) && ['streamable-http', 'sse'].includes(String(remote.type)) && httpUrl(remote.url))))) {
    issues.push('remotes (each requires an HTTP(S) url and type streamable-http or sse)');
  }
  return issues;
}

/** Shared human-readable requirements for the public OpenAPI reference. */
export const CARD_VALIDATION_REQUIREMENTS = [
  'Card checks run on registration and whenever registry_url or media_type is supplied to PUT /api/v1/orgs/{org_id}.',
  'They fetch at most 256 KiB with a three-second deadline, public-address checks, and no redirects. They do not invoke agent runtimes or certify optional protocol fields.',
  'Both formats require a JSON object with nonempty string name, description, and version.',
  'A2A (application/a2a-agent-card+json): supportedInterfaces must be a nonempty array whose entries have nonempty protocolBinding and protocolVersion strings and an absolute URL without embedded credentials. Core JSONRPC, GRPC, and HTTP+JSON bindings require HTTP(S) URLs. When supportedInterfaces is absent, a legacy HTTP(S) url is required. capabilities must be an object; defaultInputModes and defaultOutputModes must be nonempty arrays of nonempty strings. skills must be an array (possibly empty); each skill requires nonempty id, name, description and a tags array of nonempty strings (possibly empty). Custom bindings remain not_checked after structural checks.',
  'MCP (application/mcp-server-card+json): $schema must equal https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json. name must match ^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$. If remotes is present, it must be an array whose entries have type streamable-http or sse and an HTTP(S) url without embedded credentials.',
  'To correct an existing A2A/MCP card declaration, an entry administrator can PUT {"media_type":"application/a2a-agent-card+json"} (or the MCP type). The stored URL is used when registry_url is omitted. Identity and verification are preserved. Catalog and other artifact types cannot be converted by this operation. A concurrent URL/type change returns 409 CARD_CHANGED; fetch the current record and retry.',
].join('\n\n');

export async function validateRegistrationCard(
  url: string | null,
  mediaType: string,
  options: { guard?: UrlGuard; timeoutMs?: number } = {},
): Promise<CardValidation> {
  if (!(JSON_CARD_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
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
        if (body === undefined) return result('invalid', 'The card response could not be parsed as JSON within the 256 KiB response limit.');
        const issues = discoveryFieldIssues(body, mediaType);
        if (issues.length) {
          const otherType = mediaType === NANDA_MEDIA_TYPE.A2A_CARD ? NANDA_MEDIA_TYPE.MCP_CARD : NANDA_MEDIA_TYPE.A2A_CARD;
          if (discoveryFieldIssues(body, otherType).length === 0) {
            return result('invalid', `Card matches ${otherType}, but the registration declares ${mediaType}. An entry administrator can correct media_type and re-run validation.`);
          }
          return result('invalid', `Missing or invalid discovery fields for ${mediaType}: ${issues.join(', ')}.`);
        }
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
