# NANDA Index

A global switchboard for AI agent discovery. NANDA Index stores one index record per organization and maps any identity (domain, email, or URN) to the correct next discovery object: an AI Catalog, DNS-AID path, A2A Agent Card, or personal agent card.

It is the first hop in a three-hop resolution chain:

```
Requester → NANDA Index → Registry / Agent Card Host → Agent Runtime
```

NANDA Index does not host agents. It tells you where to find them.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        NANDA Index                          │
│                                                             │
│  org_id     media_type                    registry_url      │
│  ─────────  ─────────────────────────     ────────────────  │
│  acme-corp  application/ai-catalog+json   https://reg.acme  │
│  skyblue    application/vnd.dns-aid+json  (data field)      │
│  moonbakery application/a2a-agent-card    https://host39.org │
│  john       application/a2a-agent-card    https://host39.org │
└─────────────────────────────────────────────────────────────┘
```

Four registration types:

| Type | Who | How resolved |
|------|-----|-------------|
| Enterprise Registry | Orgs running their own nanda-registry | Hop 2: `GET registry_url/agents/<slug>` |
| DNS-AID | Domain-controlled discovery via DNS | Hop 2: DNS-AID lookup using `data` field |
| SMB Agent Card | Small businesses using host39.org | Hop 2: fetch card directly from `registry_url` |
| Personal Agent | Individuals, email identity | Hop 2: fetch card directly from `registry_url` |

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

DB_MAX_CONNECTIONS=10
```

---

## Registering an Organization

### Via the Web UI

Go to `https://nandaindex.org` → Sign in → Dashboard → New Organization.

Choose your registration type, fill in the form, and verify your email. Your record goes live once verified.

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
    "identifier": "urn:ai:domain:acme.com",
    "media_type": "application/ai-catalog+json",
    "description": "Acme enterprise AI Catalog.",
    "tags": ["enterprise","ai-catalog"],
    "publisher": {
      "identifier": "urn:ai:domain:acme.com",
      "displayName": "Acme Corp",
      "identityType": "dns"
    },
    "catalog_metadata": {
      "org.projectnanda.preferredDiscovery": "ai-catalog",
      "org.projectnanda.resolutionRole": "nested-ai-catalog"
    }
  }'

# Step 3: Verify your email
# Check inbox for a verification link. For testing, activate directly:
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
  registry_url:   string | null;   // null for DNS-AID entries
  ttl_seconds:    number;
  status:         "pending" | "active" | "suspended";
  email_verified: boolean;
  created_at:     string;
  updated_at:     string;

  // AI Catalog fields
  identifier:  string;             // URN, e.g. "urn:ai:domain:acme.com"
  media_type:  string;
  description: string | null;
  tags:        string[];
  publisher:   { identifier: string; displayName: string; identityType: string };
  metadata:    Record<string, unknown>;  // NANDA routing hints
  data:        Record<string, unknown>;  // DNS-AID discovery data
}
```

### media_type values

| Value | Meaning |
|-------|---------|
| `application/ai-catalog+json` | Self-hosted enterprise registry |
| `application/vnd.dns-aid+json` | DNS-AID discovery |
| `application/a2a-agent-card+json` | Direct A2A Agent Card (SMB or personal) |

### identifier URN formats

| Type | Format | Example |
|------|--------|---------|
| Enterprise / org | `urn:ai:domain:<domain>` | `urn:ai:domain:acme.com` |
| Enterprise / agent | `urn:ai:domain:<domain>:agent:<slug>` | `urn:ai:domain:acme.com:agent:support` |
| Personal | `urn:ai:email:<email>` | `urn:ai:email:john@hotmail.com` |
| Custom | any valid URN | `urn:ai:org.agntcy` |

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
curl "https://api.nandaindex.org/api/v1/resolve?locator=urn:ai:domain:acme.com:agent:flights"

{
  "locator": "urn:ai:domain:acme.com:agent:flights",
  "identifier": "flights",
  "index_record": {
    "org_id": "acme",
    "registry_url": "https://registry.acme.com",
    "media_type": "application/ai-catalog+json",
    ...
  }
}
```

---

## Resolution Chain

```
1. GET /api/v1/resolve?locator=urn:ai:domain:acme.com:agent:flights
   Returns: IndexRecord { registry_url, identifier }

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
