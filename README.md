# NANDA Index

The NANDA Index is the authoritative switchboard between catalogs for AI agents. It stores one `IndexRecord` per organization, pointing to where that org's agents live. Think of it as the ICANN of AI agents — it does not host agents itself, it tells you where to find them.

## How it fits in the resolution flow

```
Caller  →  NANDA Index          GET /api/v1/resolve?locator=urn:ai:nasiko.com:ankit
        ←  { registry_url }     "agents for nasiko.com live at https://registry.nasiko.com"

Caller  →  Registry Server      GET https://registry.nasiko.com/agents/ankit
        ←  { url }              "ankit's facts document is at https://nasiko.com/agents/ankit.json"

Caller  →  Facts URL            GET https://nasiko.com/agents/ankit.json
        ←  Agent capability document  (A2A card or equivalent)
```

The NANDA Index handles hop 1 only. It never proxies agent traffic.

---

## Quick start

```bash
cp .env.example .env
# Edit .env — set JWT_SECRET to a strong random value
docker compose up --build
```

| Service    | URL                    |
|------------|------------------------|
| API        | http://localhost:3001  |
| Web UI     | http://localhost:3000  |
| API Docs   | http://localhost:3001/docs |

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Postgres connection string |
| `JWT_SECRET` | yes (prod) | dev default | Must be ≥ 32 chars in production |
| `JWT_EXPIRES_IN` | no | `7d` | Token lifetime |
| `GOOGLE_CLIENT_ID` | no | — | OAuth — create at console.cloud.google.com |
| `GOOGLE_CLIENT_SECRET` | no | — | |
| `GITHUB_CLIENT_ID` | no | — | OAuth — create at github.com/settings/developers |
| `GITHUB_CLIENT_SECRET` | no | — | |
| `OAUTH_CALLBACK_BASE_URL` | no | `http://localhost:3001` | Base URL for OAuth redirect URIs |
| `FRONTEND_URL` | no | `http://localhost:3000` | Where to redirect after OAuth login |
| `SMTP_URL` | no | `log` | Resend API key (`re_...`). `log` prints verification links to console instead of sending |
| `EMAIL_FROM` | no | `noreply@nanda.local` | From address for verification emails |
| `PORT` | no | `3001` | API server port |
| `DB_MAX_CONNECTIONS` | no | `10` | Postgres connection pool size |
| `SIGNING_KEY_ID` | no | — | Key ID for signed IndexRecord responses |
| `SIGNING_PRIVATE_KEY` | no | — | ed25519 private key (base64) for signing |

---

## API reference

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/auth/providers` | — | Which OAuth providers are configured |
| `GET` | `/auth/google` | — | Start Google OAuth flow |
| `GET` | `/auth/google/callback` | — | Google OAuth callback |
| `GET` | `/auth/github` | — | Start GitHub OAuth flow |
| `GET` | `/auth/github/callback` | — | GitHub OAuth callback |
| `POST` | `/auth/register` | — | Create account with email + password |
| `POST` | `/auth/login` | — | Sign in, returns JWT |
| `GET` | `/api/v1/me` | JWT | Current user profile + org memberships |

### Index records (public)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/index` | — | List all active IndexRecords |
| `GET` | `/api/v1/index/:org_id` | — | Get one IndexRecord by org ID |
| `GET` | `/api/v1/verify-email` | — | Verify org email (`?token=`) |

### Organizations (protected)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/orgs` | JWT | Register a new organization (sends verification email) |
| `GET` | `/api/v1/orgs/:org_id` | JWT | Get org (must be a member) |
| `PUT` | `/api/v1/orgs/:org_id` | JWT | Update org fields |
| `DELETE` | `/api/v1/orgs/:org_id` | JWT | Permanently delete org |
| `DELETE` | `/api/v1/orgs/:org_id/suspend` | JWT | Suspend org (removes from public index) |
| `POST` | `/api/v1/orgs/:org_id/reactivate` | JWT | Reactivate a suspended org |

### Resolution + search (public)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/resolve` | — | Resolve a URN locator (`?locator=urn:ai:domain:agent`) |
| `GET` | `/api/v1/search` | — | Search orgs by keyword or URN (`?q=`) |

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe — `{ status, db }` |

#### Agent locator format

```
urn:ai:nasiko.com:ankit
 ↑   ↑  ↑          ↑
 |   |  domain     identifier
 |   nid (namespace — any RFC 8141-valid value)
 urn  (required prefix)
```

#### Error shape

All errors return:
```json
{ "error": "ERROR_CODE", "detail": "human-readable message" }
```

---

## Database schema

### `users`
Accounts created via OAuth (Google/GitHub) or email/password.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `email` | VARCHAR(255) | Unique |
| `display_name` | VARCHAR(255) | Optional |
| `avatar_url` | VARCHAR(512) | OAuth only |
| `provider` | VARCHAR(20) | `google`, `github`, or `email` |
| `provider_id` | VARCHAR(255) | OAuth provider's user ID |
| `password_hash` | VARCHAR(255) | Email/password accounts only |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### `organizations`
One row per registered org — the core IndexRecord.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `org_id` | VARCHAR(64) | Unique slug, e.g. `nasiko`. Lowercase, hyphens. Permanent. |
| `display_name` | VARCHAR(255) | Human-readable name |
| `domain` | VARCHAR(255) | Unique. Agents are addressable under this domain. |
| `contact_email` | VARCHAR(255) | Used for email verification |
| `registry_url` | VARCHAR(512) | URL of the org's Registry Server |
| `email_verified` | BOOLEAN | `true` once verification link is clicked |
| `verify_token` | VARCHAR(64) | One-time token emailed on registration |
| `verify_token_expires_at` | TIMESTAMPTZ | Token expiry — 24h after registration |
| `ttl_seconds` | INTEGER | Cache hint for resolvers. Default 86400 (24h) |
| `status` | VARCHAR(20) | `pending`, `active`, or `suspended` |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### `org_memberships`
Which users can manage which organizations.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK → `users.id` |
| `org_id` | VARCHAR(64) | FK → `organizations.org_id` |
| `role` | VARCHAR(20) | `admin` or `member` |
| `created_at` | TIMESTAMPTZ | |

---

## Local development (without Docker)

```bash
# 1. Start Postgres
docker compose up db -d

# 2. Install dependencies
cd server && npm install

# 3. Create .env in server/
cp ../.env.example .env
# Set DATABASE_URL=postgresql://nanda:nanda-local@localhost:5433/nanda_index

# 4. Run migrations + start
npm run migrate
npm run dev
```

```bash
# Web (separate terminal)
cd web && npm install && npm run dev
```

---

## Tech stack

| Concern | Technology |
|---|---|
| Runtime | Node.js 20, TypeScript |
| Framework | Fastify 5 |
| Database | PostgreSQL 16, postgres.js (no ORM) |
| Auth | @fastify/oauth2 (Google + GitHub), @fastify/jwt, bcryptjs |
| Email | Resend SDK (`SMTP_URL=log` prints to console in dev) |
| Tests | Vitest + fastify.inject() |
| Frontend | Next.js 15, Tailwind CSS 4 |
