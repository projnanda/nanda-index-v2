// Stub nanda-registry for load tests.
//
// Seeded enterprise orgs carry registry_url = http://stub-registry:8090/<domain>,
// so agentic search calls GET /<domain>/agents/search?q=... here. The reply
// waits STUB_LATENCY_MS (a stand-in for a real registry across the internet)
// and returns STUB_ENTRIES agents whose shape passes the server's
// sanitizeRemoteEntry: bare identifiers, https URLs.

import { createServer } from 'node:http';

function intFromEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const PORT = intFromEnv('STUB_PORT', 8090);
const LATENCY_MS = intFromEnv('STUB_LATENCY_MS', 150);
const ENTRY_COUNT = intFromEnv('STUB_ENTRIES', 5);
const SEARCH_PATH = /^\/([a-z0-9.-]+)\/agents\/search$/;

let searchCalls = 0;

function buildEntries(domain, query) {
  return Array.from({ length: ENTRY_COUNT }, (_, i) => ({
    identifier: `agent-${i + 1}`,
    displayName: `${domain} agent ${i + 1}`,
    mediaType: 'application/a2a-agent-card+json',
    url: `https://${domain}/agents/${i + 1}`,
    description: `Handles ${query} requests for ${domain}`,
    tags: ['loadtest', 'stub'],
    version: '1.0.0',
  }));
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://stub');
  if (url.pathname === '/health') {
    send(res, 200, { ok: true });
    return;
  }
  if (url.pathname === '/stats') {
    // run.sh reads this before and after a test: proof fan-out happened.
    send(res, 200, { searchCalls });
    return;
  }
  const match = SEARCH_PATH.exec(url.pathname);
  if (req.method !== 'GET' || !match) {
    send(res, 404, { error: 'not_found' });
    return;
  }
  searchCalls += 1;
  const entries = buildEntries(match[1], url.searchParams.get('q') ?? '');
  setTimeout(() => send(res, 200, { specVersion: '1.0', entries }), LATENCY_MS);
});

server.on('error', (err) => {
  process.stderr.write(`stub-registry failed: ${err.message}\n`);
  process.exit(1);
});

server.listen(PORT, () => {
  process.stdout.write(`stub-registry on :${PORT}, latency ${LATENCY_MS}ms, ${ENTRY_COUNT} entries\n`);
});
