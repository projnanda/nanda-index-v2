# NANDA Index

A global switchboard for AI agent discovery. NANDA Index stores one AI Catalog-formatted index record per organization and maps a stable resource identifier — an ARD domain-anchored `urn:air:<publisher-FQDN>:<namespace...>:<short-name>` — to the correct next discovery object: an AI Catalog, a DNS-based service-discovery (SVCB) pointer, an A2A Agent Card, or a personal agent card.

It is the first hop in a three-hop resolution chain:

```
Requester → NANDA Index → Registry / Agent Card Host → Agent Runtime
```

NANDA Index does not host agents. It tells you where to find them.

A worked example of the whole chain lives in [`demo/`](demo/): an agent that
searches the index for two organisations, follows each to the agent it needs by a
different route, books a restaurant, and leaves a signed record. MIT-licensed,
separate from this repository's Apache-2.0 license.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                            NANDA Index                            │
│                                                                   │
│  identifier                                     registry_url      │
│  ─────────────────────────────────────────────  ────────────────  │
│  urn:air:acme.com:catalog:root                  registry.acme.com │
│  urn:air:skyblue.com:agent:refunds              api.skyblue.com   │
│  urn:air:moonbakery.com:agent:orders            host39.org        │
│  urn:air:host39.org:personal:john@hotmail.com   host39.org        │
└───────────────────────────────────────────────────────────────────┘
```

Four registration types:

| Type | Who | How resolved |
|------|-----|-------------|
| Enterprise AI Catalog | Orgs running their own nanda-registry-server | Hop 2: `GET registry_url/agents/<slug>` |
| DNS SVCB (`dns-svcb`) | Domain-controlled discovery via DNS service binding (RFC 9460) | Hop 2: fetch the A2A Agent Card at `registry_url` (verifiable via the domain's SVCB records) |
| SMB Agent Card | Small businesses using host39.org | Hop 2: fetch card directly from `registry_url` |
| Personal Agent | Individuals without a domain; identifier anchored to host39.org, email as `subjectAccount` | Hop 2: fetch card directly from `registry_url` |

---

## Stack

- **API:** Fastify 5, TypeScript, Node.js 20
- **Database:** PostgreSQL 16, postgres.js v3
- **Frontend:** Next.js 16, TailwindCSS v4
- **Auth:** Email/password + Google OAuth + GitHub OAuth, JWT
- **Proxy:** Caddy 2 (TLS auto-provisioned)

---

## Local Development

```bash
git clone https://github.com/projnanda/nanda-index-v2
cd nanda-index-v2
cp .env.example .env
docker compose up --build
```

| Service | URL |
|---------|-----|
| Web UI  | http://localhost:3000 |
| API     | http://localhost:3001 |
| DB      | localhost:5433 |

---

## Production Deployment

### Prerequisites

- VPS with 2GB RAM (1GB works with swap — see below)
- Docker and Docker Compose installed
- DNS A records pointing to your server:
  - `nandaindex.org` → server IP
  - `api.nandaindex.org` → server IP

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/projnanda/nanda-index-v2
cd nanda-index-v2

# 2. Configure environment
cp .env.prod.example .env.prod
# Edit .env.prod and fill in every value

# 3. Add 2GB swap (required on 1GB servers — Next.js build is memory heavy)
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# 4. Build and start
docker compose -f docker-compose.prod.yml --env-file .env.prod up --build -d

# 5. Verify
curl https://api.nandaindex.org/health
```

### Environment Variables

```env
# Database
POSTGRES_PASSWORD=          # strong random password

# JWT — generate with: openssl rand -hex 64
JWT_SECRET=
JWT_EXPIRES_IN=1d

# OAuth (optional — leave blank to disable)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
OAUTH_CALLBACK_BASE_URL=https://api.nandaindex.org

# Email — use Resend in production, "log" prints to console in dev
SMTP_URL=re_YOUR_RESEND_API_KEY
EMAIL_FROM=noreply@nandaindex.org

# URLs
FRONTEND_URL=https://nandaindex.org
NEXT_PUBLIC_NANDA_INDEX_API_URL=https://api.nandaindex.org

# Google Analytics (GA4) — optional, omit to disable tracking
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX

# PostHog — optional, omit to disable. One project key drives both the web app
# (consent-gated analytics + masked session replay, proxied via /ingest) and the
# API (anonymous sign-up / entry lifecycle counts). Host: US (default), EU or self-hosted.
NEXT_PUBLIC_POSTHOG_KEY=phc_XXXXXXXXXX
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com

DB_MAX_CONNECTIONS=10

# Concierge demo at https://nandaindex.org/demo — all optional, defaults shown
DEMO_BASE_URL=https://nandaindex.org/demo
DEMO_RUN_LIMIT_PER_HOUR=3          # live runs per visitor per hour; 0 = unlimited
DEMO_PUBLIC_INDEX_URL=https://api.nandaindex.org
```

### Concierge demo (`/demo`)

`docker compose up` also starts the concierge demo (`demo/`), served by Caddy at
`https://nandaindex.org/demo`. It is an agent, not just a page: its signing key,
its grant and its last run live on the `demo_data` volume. **Never delete that
volume** — the agent's name is derived from the key, so a new volume is a
different agent with no grant and no registration.

The first deploy needs two one-time steps, because a grant names a key that has
to exist first:

```bash
# 1. Read the DID the agent generated for itself
curl -s https://nandaindex.org/demo/healthz          # → "did": "did:key:z6Mk…"

# 2. Mint the host's grant for that DID, onto the volume the agent reads.
#    HOST_SEED is the host's key material: keep it private and keep it, or no
#    replacement or revocation can ever be minted for this host identity.
docker compose -f docker-compose.prod.yml --env-file .env.prod exec \
  -e AGENT_DID='did:key:z6Mk…' -e HOST_SEED='…' demo python tools/mint_grant.py

# 3. Restart so it loads the grant; it registers itself with the second index
#    on start and renews every hour after that.
docker compose -f docker-compose.prod.yml --env-file .env.prod restart demo
curl -s https://nandaindex.org/demo/ui/authority     # names the same DID
```

The grant expires after 90 days — repeat step 2 with the same `HOST_SEED`.
Visitors see the last run replayed in the step-by-step player on load; each
visitor may start `DEMO_RUN_LIMIT_PER_HOUR` live runs, because a live run sends
real messages to two companies' agents and holds a real table.

---

## Registering an Organization

### Via the Web UI

Go to `https://nandaindex.org` → Sign in → Dashboard → New Organization.

Choose your registration type, fill in the form, and verify your email. Personal (no-domain) agents go live as soon as email is verified. Registry/DNS SVCB/SMB registrations also require verifying ownership of the domain (via a DNS TXT record) before going live.

### Via the API

```bash
# Step 1: Create an account
curl -X POST https://api.nandaindex.org/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}'
# Returns: { "token": "eyJ..." }

# Step 2: Register your organization
TOKEN="eyJ..."

curl -X POST https://api.nandaindex.org/api/v1/orgs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "org_id": "acme",
    "display_name": "Acme Corp",
    "hosting_path": "registry",
    "domain": "acme.com",
    "contact_email": "agents@acme.com",
    "registry_url": "https://registry.acme.com",
    "description": "Acme enterprise AI Catalog.",
    "tags": ["enterprise","ai-catalog"]
  }'
# The server derives the AI Catalog fields from hosting_path + domain:
#   identifier  urn:air:acme.com:catalog:root   (must be anchored to your domain)
#   publisher   { "identifier": "acme.com", "displayName": "Acme Corp", "identityType": "dns" }
#   extensions  { "org.projectnanda": { "resolutionRole": "nested-ai-catalog",
#                                       "preferredDiscovery": "ai-catalog", ... } }
# You may pass your own `extensions` (e.g. runtime.* / auth.* hints) and an
# `identifier` under urn:air:<your-domain>:; resolutionRole, preferredDiscovery,
# authoritativeSystem and subjectAccount are always server-owned.

# Step 3: Verify your email
# Check inbox for a verification link. This example uses hosting_path "registry"
# (has a domain), so email verification alone won't activate it — domain
# ownership must also be verified via POST /orgs/:org_id/domain-challenge and
# /verify-domain. (Personal, no-domain orgs activate on email verification alone.)
# For testing, activate directly:
# docker compose exec db psql -U nanda -d nanda_index -c \
#   "UPDATE organizations SET status='active', email_verified=true WHERE org_id='acme';"
```

---

## Schema

### IndexRecord

```typescript
interface IndexRecord {
  org_id:         string;
  display_name:   string;
  domain:         string | null;   // null for personal (email-identity) entries
  registry_url:   string | null;   // catalog URL or agent card URL
  ttl_seconds:    number;
  status:         "pending" | "active" | "suspended";
  email_verified: boolean;
  created_at:     string;
  updated_at:     string;

  // AI Catalog fields
  identifier:  string;             // e.g. "urn:air:acme.com:catalog:root"
  media_type:  string;             // the AI Catalog entry `type`
  description: string | null;
  tags:        string[];
  publisher:   { identifier: string; displayName: string; identityType: string }; // identifier = bare domain
  extensions:  Record<string, Record<string, unknown>>; // { "org.projectnanda": { resolutionRole, ... } }
  data?:       Record<string, unknown>;  // inline artifact (AI Catalog url XOR data)
}
```

### media_type values

| Value | Meaning |
|-------|---------|
| `application/ai-catalog+json` | Self-hosted enterprise registry |
| `application/ai-registry+json` | ARD-compatible directory (e.g. AGNTCY ADS) |
| `application/a2a-agent-card+json` | Direct A2A Agent Card (SMB, personal, or DNS SVCB pointer) |
| `application/mcp-server-card+json` | MCP server descriptor |
| `application/agentskill+zip` | Agent skill bundle |

### identifier URN formats

| Type | Format | Example |
|------|--------|---------|
| Enterprise catalog | `urn:air:<domain>:catalog:root` | `urn:air:example.com:catalog:root` |
| Agent (SMB / DNS SVCB) | `urn:air:<domain>:agent:<short-name>` | `urn:air:moonbakery.com:agent:orders` |
| ARD directory | `urn:air:<domain>:registry:<name>` | `urn:air:acme.com:registry:ard` |
| Personal | `urn:air:host39.org:personal:<email>` | `urn:air:host39.org:personal:john@hotmail.com` |

Identifiers follow ARD's `urn:air:<publisher-FQDN>:<namespace...>:<short-name>`. The publisher FQDN must be the domain you verified; personal identifiers are derived from your verified email. The retired `urn:ai:*` forms are rejected.

---

## API Reference

### Auth

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/auth/register` | `{ email, password, display_name? }` | `{ token }` |
| `POST` | `/auth/login` | `{ email, password }` | `{ token }` |
| `GET`  | `/api/v1/me` | — | User profile + org memberships |
| `GET`  | `/auth/providers` | — | `{ google, github }` |
| `GET`  | `/auth/google/callback` | — | OAuth redirect |
| `GET`  | `/auth/github/callback` | — | OAuth redirect |

### Public Index

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/index` | List all active index entries, in the paper's AI Catalog entry shape (`identifier`, `displayName`, `type`, `url`, `publisher`, `extensions`); operational state (`orgId`, `status`, `ttlSeconds`, verification flags) is under `extensions["org.projectnanda"]` |
| `GET` | `/api/v1/index/:org_id` | Get a single live index entry (same shape); `404` for pending, suspended or unproven (domain not verified) orgs, the same as an unknown `org_id` |
| `GET` | `/api/v1/resolve?locator=<urn>` | Resolve a URN to its AI Catalog entry |
| `GET` | `/api/v1/search?q=<query>` | Keyword or URN search |
| `GET` | `/api/v1/verify-email?token=<token>` | Activate org via email link |

### Organization Management (JWT required)

| Method | Path | Description |
|--------|------|-------------|
| `POST`   | `/api/v1/orgs` | Register a new organization |
| `GET`    | `/api/v1/availability?org_id=&domain=` | Whether an `org_id` and/or domain is still free to register (`{ org_id_available, domain_available }`); used by the registration form's first step. Mirrors registration: a domain is taken only once a verified entry holds it; an `org_id` is taken unless its holder is an abandoned unverified claim; reserved `org_id`s are unavailable |
| `GET`    | `/api/v1/orgs/:org_id` | Get your own org |
| `PUT`    | `/api/v1/orgs/:org_id` | Update org fields |
| `DELETE` | `/api/v1/orgs/:org_id` | Permanently delete |
| `DELETE` | `/api/v1/orgs/:org_id/suspend` | Suspend (removes from public index) |
| `POST`   | `/api/v1/orgs/:org_id/reactivate` | Reactivate a suspended org |
| `POST`   | `/api/v1/orgs/:org_id/claim` | Recover an entry with no administrator using account-bound DNS or personal-email proof |

### Recovering an entry with no administrator

Migration `019_org_recovery.sql` adds dedicated recovery challenges. Apply the
server migrations before deploying the updated API. Any verified account may
start recovery; completion requires fresh ownership proof tied to that same
account. An account's verified login email alone does not prove ownership of an
entry's domain or personal email identity.

For a **domain-backed entry**, call `POST /api/v1/orgs/:org_id/claim` with the
account's bearer token and no body (or `{}`). The `202` response supplies
`method: "dns"`, `record_name`, `record_value`, and `expires_at`. Publish the
supplied TXT record at `_nanda-recovery.<domain>`, then call the endpoint again
using the same account. A successful claim returns `201` and grants admin access.
DNS challenges last seven days. Each account gets an independent challenge;
registration's `_nanda-challenge` record is unaffected.

For a **personal entry**, the same initial request returns `202` with
`method: "email"` and sends a 15-minute recovery code to the stored email bound
to the personal identifier and `subjectAccount`. The API never returns the code.
Complete recovery from the same account with `{"token":"<code from email>"}`.
The login email may differ from the personal entry's address: the fresh mailbox
proof and the initiating account session are both required. Repeating the initial
request while its challenge is live does not resend email; after expiry, a new
initial request issues a new code. Failed email delivery allows an immediate retry.

| Entry | Recovery proof | Supported media types |
|-------|----------------|-----------------------|
| Domain-backed | DNS | AI Catalog, AI Registry, ANS Registry, A2A card, MCP card, agent skill |
| Personal, no domain | Registered email | A2A card, MCP card, agent skill |

Only currently proven entries in `active` or `suspended` state can be recovered.
Pending, unverified, and taken-down entries are refused (`409`). Suspension and
hidden moderation are preserved. An existing admin prevents recovery (`409`);
an ordinary member can be promoted if no admin exists. Recovery changes membership
only, preserving identifiers, media types, URLs, and all discovery behavior.

The grant and consumption of all competing recovery proofs happen in one locked
database transaction. Expired, consumed, or identity-invalidated proofs cannot
grant access. Changing an identity away and back also invalidates its old proofs.
Requests retain the per-IP org-write limit and add a per-account hourly limit
(`ORG_RECOVERY_RATE_LIMIT_MAX`, default 30). Each address can have at most three
live recovery emails at once, across all entries and accounts (`429` beyond that,
for up to 15 minutes). If the entry already has an administrator, no email is sent,
but the response is the same `202`, so the request reveals nothing about admin
state. HTTP limits are per API process; the email cap and proof lifecycle are
coordinated in PostgreSQL.

### Resolution Example

```bash
curl "https://api.nandaindex.org/api/v1/resolve?locator=urn:air:acme.com:agent:flights"

{
  "locator": "urn:air:acme.com:agent:flights",
  "identifier": "flights",
  "match": "publisher",          // "exact" when an entry has exactly this identifier
  "entry": {                     // an AI Catalog entry (paper §5.4), same shape as GET /api/v1/index
    "identifier": "urn:air:acme.com:catalog:root",
    "displayName": "Acme",
    "type": "application/ai-catalog+json",
    "url": "https://registry.acme.com",
    "publisher": { "identifier": "acme.com", "displayName": "Acme", "identityType": "dns" },
    "extensions": { "org.projectnanda": { "resolutionRole": "nested-ai-catalog", "orgId": "acme", ... } },
    ...
  }
}
```

---

## Resolution Chain

```
1. GET /api/v1/resolve?locator=urn:air:acme.com:agent:flights
   Returns: { match, identifier, entry { url, type, ... } }
   (match "exact" on an agent card → entry.url is the card; skip to 3)

2. GET <entry.url>/agents/<identifier>
   Returns: CatalogEntry { url (facts URL) }

3. GET <catalogEntry.url>
   Returns: A2A Agent Card { url (runtime endpoint) }

4. POST <agentCard.url>/run
   Returns: Agent response
```

---

## Organization email verification upgrade (migration 020)

`organizations.verify_token` stores a SHA-256 hex digest. Email links and API
payloads are unchanged. Migration 020 clears outstanding tokens and expiry values;
ownership proofs, memberships, and publication status are preserved. Old links
require a new email via `POST /api/v1/orgs/:org_id/resend-verification`.

Stop all old API instances before deploying. The entrypoint applies migration 020
before serving requests. Mixed versions are unsupported because old code writes
plaintext tokens. For rollback, stop all instances and clear outstanding tokens
and expiry values before starting the old version; users must request new links.

`POST /api/v1/verify-email` uses `AUTH_RATE_LIMIT_MAX` (default `10`) and
`AUTH_RATE_LIMIT_WINDOW` (default `1 minute`) per client IP per API instance.
Excess requests return `429` with `Retry-After` without consuming tokens. Client
IP selection follows `TRUST_PROXY_HOPS`. GET remains a non-consuming redirect.

## Health Check

```bash
curl https://api.nandaindex.org/health
# { "status": "ok", "db": "ok" }
```

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).
