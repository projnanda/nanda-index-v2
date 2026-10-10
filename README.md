# NANDA Index

A global switchboard for AI agent discovery. NANDA Index stores one AI Catalog-formatted index record per organization and maps a stable resource identifier — an ARD domain-anchored `urn:air:<publisher-FQDN>:<namespace...>:<short-name>` — to the correct next discovery object: an AI Catalog, a DNS-based service-discovery (SVCB) pointer, an A2A Agent Card, or a personal agent card.

It is the first hop in a three-hop resolution chain:

```
Requester → NANDA Index → Registry / Agent Card Host → Agent Runtime
```

NANDA Index does not host agents. It tells you where to find them.

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
│  urn:air:host39.org:personal:john-hotmail-com   host39.org        │
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
JWT_EXPIRES_IN=7d

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

DB_MAX_CONNECTIONS=10
```

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
| Personal | `urn:air:host39.org:personal:<email-slug>` | `urn:air:host39.org:personal:john-hotmail-com` |

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
| `GET` | `/api/v1/index` | List all active organizations |
| `GET` | `/api/v1/index/:org_id` | Get a single IndexRecord |
| `GET` | `/api/v1/resolve?locator=<urn>` | Resolve a URN to an IndexRecord |
| `GET` | `/api/v1/search?q=<query>` | Keyword or URN search |
| `GET` | `/api/v1/verify-email?token=<token>` | Activate org via email link |

### Organization Management (JWT required)

| Method | Path | Description |
|--------|------|-------------|
| `POST`   | `/api/v1/orgs` | Register a new organization |
| `GET`    | `/api/v1/orgs/:org_id` | Get your own org |
| `PUT`    | `/api/v1/orgs/:org_id` | Update org fields |
| `DELETE` | `/api/v1/orgs/:org_id` | Permanently delete |
| `DELETE` | `/api/v1/orgs/:org_id/suspend` | Suspend (removes from public index) |
| `POST`   | `/api/v1/orgs/:org_id/reactivate` | Reactivate a suspended org |

### Resolution Example

```bash
curl "https://api.nandaindex.org/api/v1/resolve?locator=urn:air:acme.com:agent:flights"

{
  "locator": "urn:air:acme.com:agent:flights",
  "identifier": "flights",
  "match": "publisher",          // "exact" when an entry has exactly this identifier
  "index_record": {
    "org_id": "acme",
    "identifier": "urn:air:acme.com:catalog:root",
    "registry_url": "https://registry.acme.com",
    "media_type": "application/ai-catalog+json",
    ...
  }
}
```

---

## Resolution Chain

```
1. GET /api/v1/resolve?locator=urn:air:acme.com:agent:flights
   Returns: { match, identifier, index_record { registry_url, ... } }
   (match "exact" on an agent card → registry_url is the card; skip to 3)

2. GET <registry_url>/agents/<identifier>
   Returns: CatalogEntry { url (facts URL) }

3. GET <catalogEntry.url>
   Returns: A2A Agent Card { url (runtime endpoint) }

4. POST <agentCard.url>/run
   Returns: Agent response
```

---

## Health Check

```bash
curl https://api.nandaindex.org/health
# { "status": "ok", "db": "ok" }
```

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).
