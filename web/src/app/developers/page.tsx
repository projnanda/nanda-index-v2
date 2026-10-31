import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { apiBaseUrl, apiDocsUrl, openApiUrl } from "@/lib/api-docs";
import { externalLinks } from "@/lib/site-data";

// Absolute so the title reads the same with or without a site-wide template.
export const metadata: Metadata = {
  title: { absolute: "Developers - NANDA Index" },
  description: "Use the NANDA Index REST API: resolve, index and search, register and verify an entry, rate limits and error codes.",
};

// Facts below follow the API server (server/src): routes/*.ts for request
// and response shapes, config/index.ts and plugins/rateLimit.ts for limits,
// plugins/errorHandler.ts and the error codes each route sends.

const EXAMPLE_URN = "urn:air:moonbakery39.com:agent:orders";

const QUICKSTART = [
  {
    id: "resolve",
    title: "Resolve an identifier",
    note: "Returns the entry registered under that identifier, or the publisher's catalog entry when the publisher fronts its agents with an AI Catalog (match is \"exact\" or \"publisher\").",
    command: (api: string) => `curl "${api}/api/v1/resolve?locator=${EXAMPLE_URN}"`,
    response: `{ "locator": "${EXAMPLE_URN}", "identifier": "orders", "match": "exact",
  "entry": { "identifier": "...", "displayName": "...", "type": "application/a2a-agent-card+json",
             "url": "...", "publisher": { ... }, "extensions": { "org.projectnanda": { ... } } } }`,
  },
  {
    id: "index",
    title: "List the index",
    note: "A JSON array of live entries in the AI Catalog entry shape. Pages with limit (1 to 500, default 100) and offset; the total is in the X-Total-Count response header.",
    command: (api: string) => `curl -i "${api}/api/v1/index?limit=20&offset=0"`,
    response: `X-Total-Count: 105

[ { "identifier": "urn:air:...", "displayName": "...", "type": "...", "url": "...", "tags": [...], ... } ]`,
  },
  {
    id: "entry",
    title: "Get one entry by org ID",
    note: "The same shape as a list item. Pending, suspended, unproven and taken-down entries answer 404, the same as an unknown org ID.",
    command: (api: string) => `curl "${api}/api/v1/index/moon-bakery"`,
    response: null,
  },
  {
    id: "search",
    title: "Search by keyword",
    note: "Matches org IDs, domains, names, identifiers, tags and descriptions; at most 50 results. A query that starts with urn:air: is resolved like the resolve endpoint. Results use the owner record shape with snake_case fields (org_id, display_name, registry_url, ...), not the entry shape above.",
    command: (api: string) => `curl "${api}/api/v1/search?q=bakery"`,
    response: `{ "query": "bakery", "count": 1, "results": [ { "org_id": "moon-bakery", "display_name": "Moon Bakery", ... } ] }`,
  },
  {
    id: "agentic-search",
    title: "Describe what you need",
    note: "Ranks entries for a plain-language request and asks enterprise registries for matching agents. limit is 1 to 50 (default 20). Slower, and limited more tightly than the other reads.",
    command: (api: string) => `curl "${api}/api/v1/agentic-search?q=order%20a%20custom%20cake&limit=5"`,
    response: `{ "query": "...", "count": 1, "candidates": [ ... ], "resolved": { ... } | null,
  "referrals": [], "orgsQueried": 1, "orgsUnreachable": [], "tookMs": 1140 }`,
  },
];

const LIFECYCLE = [
  {
    title: "Create an account",
    body: "Returns a session token right away and emails a verification link. Until you confirm the link, every write to the index answers 403 ACCOUNT_NOT_VERIFIED.",
    command: (api: string) => `curl -X POST "${api}/auth/register" -H "Content-Type: application/json" \\
  -d '{"email":"you@example.com","password":"a-long-password"}'
# 201 {"token":"eyJ..."}

curl -X POST "${api}/auth/verify-account" -H "Content-Type: application/json" \\
  -d '{"token":"<token from the email link>"}'
# 200 {"ok":true}`,
  },
  {
    title: "Sign in",
    body: "Every write needs the token in an Authorization header. Tokens expire after a day by default; sign in again to get a new one.",
    command: (api: string) => `curl -X POST "${api}/auth/login" -H "Content-Type: application/json" \\
  -d '{"email":"you@example.com","password":"a-long-password"}'
# 200 {"token":"eyJ..."}
export TOKEN="eyJ..."`,
  },
  {
    title: "Register an entry",
    body: "Required: org_id, display_name, contact_email and registry_url (HTTP or HTTPS; use HTTPS). hosting_path is registry (default), dns-svcb, smb or personal; every path except personal needs a domain, and personal must not send one. The server derives the identifier, media type and publisher from the path and domain. A personal entry has no domain: its identifier is urn:air:host39.org:personal:<contact email, lowercased>, so that email is public once the entry is live. The entry starts as pending.",
    command: (api: string) => `curl -X POST "${api}/api/v1/orgs" -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" -d '{
    "org_id": "acme", "display_name": "Acme Corp", "hosting_path": "registry",
    "domain": "acme.com", "contact_email": "agents@acme.com",
    "registry_url": "https://registry.acme.com",
    "description": "Acme enterprise AI Catalog.", "tags": ["enterprise"]
  }'
# 201 {"org_id":"acme","status":"pending","identifier":"urn:air:acme.com:catalog:root", ...}`,
  },
  {
    title: "Verify and go live",
    body: "An entry with a domain is published once a DNS TXT record proves the domain. Request the challenge, publish the record, then ask the index to check it; the same challenge is returned until it expires (7 days). A personal entry has no domain and goes live when its contact email is confirmed through the emailed link. Domain entries should confirm their contact email too, so the index can reach them.",
    command: (api: string) => `curl -X POST "${api}/api/v1/orgs/acme/domain-challenge" -H "Authorization: Bearer $TOKEN"
# 200 {"domain":"acme.com","record_name":"_nanda-challenge.acme.com","record_type":"TXT",
#      "record_value":"nanda-verify=<token>","expires_at":"..."}

# publish that TXT record at your DNS host, then:
curl -X POST "${api}/api/v1/orgs/acme/verify-domain" -H "Authorization: Bearer $TOKEN"
# 200 {... "domain_verified":true,"status":"active" ...}
# 400 DOMAIN_NOT_VERIFIED while the record is not visible yet

# personal entries instead confirm the emailed link:
curl -X POST "${api}/api/v1/verify-email" -H "Content-Type: application/json" -d '{"token":"<token from the email link>"}'`,
  },
  {
    title: "Update",
    body: "Editable fields: display_name, domain, registry_url, ttl_seconds (3600 to 604800), description, tags, version, publisher.displayName, extensions, entry_data and trust_manifest. Anything else, including org_id, contact_email, hosting_path and the identifier, answers 400 UNKNOWN_FIELDS. Changing the domain means proving the new one.",
    command: (api: string) => `curl -X PUT "${api}/api/v1/orgs/acme" -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" -d '{"description":"Acme agents and tools.","ttl_seconds":21600}'
# 200 {... the updated record ...}`,
  },
  {
    title: "Suspend, reactivate or delete",
    body: "Suspending hides the entry from the public index and keeps it; reactivating puts it back. Deleting is permanent and answers 204 with no body.",
    command: (api: string) => `curl -X DELETE "${api}/api/v1/orgs/acme/suspend" -H "Authorization: Bearer $TOKEN"
curl -X POST   "${api}/api/v1/orgs/acme/reactivate" -H "Authorization: Bearer $TOKEN"
curl -X DELETE "${api}/api/v1/orgs/acme" -H "Authorization: Bearer $TOKEN"
# 204`,
  },
];

const RATE_LIMITS = [
  { routes: "Public reads: /api/v1/index, /api/v1/index/:org_id, /api/v1/search, /api/v1/resolve, GET /api/ard/agents, POST /api/ard/explore", limit: "120 requests per minute per IP address, counted separately for each route" },
  { routes: "Agentic search: /api/v1/agentic-search, /api/ard/search", limit: "30 requests per minute per IP address, counted separately for each route" },
  { routes: "Account routes: /auth/register, /auth/login, password reset, account verification, resend", limit: "10 requests per minute per IP address, counted separately for each route; sign-in locks for 15 minutes after 5 failed attempts for one email from one network, doubling on further failures" },
  { routes: "Entry writes: POST /api/v1/orgs, PUT /api/v1/orgs/:org_id, POST /api/v1/orgs/:org_id/claim", limit: "30 requests per hour per IP address, counted separately for each route; claim also has a 30 per hour budget per account across all IP addresses" },
];

const ERROR_CODES = [
  { status: 400, code: "FST_ERR_VALIDATION", meaning: "The request does not match the route's schema; detail names the field." },
  { status: 400, code: "VALIDATION", meaning: "A registration rule was broken: domain, hosting_path, registry_url or identifier." },
  { status: 400, code: "UNKNOWN_FIELDS", meaning: "PUT named a field that cannot be changed; detail lists the editable ones." },
  { status: 400, code: "PAYLOAD_TOO_LARGE", meaning: "extensions, entry_data or trust_manifest is over 16 KB or nested deeper than 6 levels." },
  { status: 400, code: "RESERVED_ORG_ID", meaning: "That org_id is reserved; choose another." },
  { status: 400, code: "NO_DOMAIN", meaning: "Domain verification was requested for a personal entry, which has no domain." },
  { status: 400, code: "NO_ACTIVE_CHALLENGE", meaning: "verify-domain was called before domain-challenge, or the challenge expired." },
  { status: 400, code: "DOMAIN_NOT_VERIFIED", meaning: "The TXT record was not found yet; detail says what was expected and what was seen." },
  { status: 400, code: "INVALID_TOKEN", meaning: "An account-verification or password-reset token is invalid or expired." },
  { status: 400, code: "invalid_locator", meaning: "The resolve locator is not a valid urn:air: identifier." },
  { status: 401, code: "UNAUTHORIZED", meaning: "Wrong email or password on sign-in, or no valid session token (missing, expired or revoked); sign in again." },
  { status: 403, code: "ACCOUNT_NOT_VERIFIED", meaning: "Confirm your account email before writing to the index." },
  { status: 403, code: "FORBIDDEN", meaning: "You are not an admin of that entry." },
  { status: 403, code: "MODERATED", meaning: "An index operator took the entry down; it cannot be suspended or reactivated by its owner (edits and deletion still work)." },
  { status: 404, code: "NOT_FOUND", meaning: "No such entry, or it is not live (index reads), or the verify-email token was not found, already used or expired." },
  { status: 404, code: "not_found", meaning: "Resolve found no live entry for the locator." },
  { status: 409, code: "CONFLICT", meaning: "Already taken: the account email, an org_id held by another registration, or a domain or personal identity that another registration has already proven." },
  { status: 409, code: "ALREADY_VERIFIED", meaning: "The contact email is already verified." },
  { status: 409, code: "NOT_SUSPENDED", meaning: "Only a suspended entry can be reactivated." },
  { status: 422, code: "query_too_short", meaning: "Search needs at least 2 non-space characters." },
  { status: 429, code: "TOO_MANY_ATTEMPTS", meaning: "Sign-in is locked for this email and network after repeated failures." },
  { status: 429, code: "TOO_MANY_UNVERIFIED", meaning: "You already hold 5 unverified registrations from the last 48 hours; verify or delete one first." },
  { status: 429, code: "RESEND_COOLDOWN", meaning: "A verification email was sent less than 60 seconds ago." },
  { status: 503, code: "db_unreachable", meaning: "/health could not reach the database." },
];

const linkClass = "underline hover:text-ink-strong";
// Blocks scroll sideways on narrow screens; tabIndex={0} lets keyboard users reach and scroll them.
const preClass = "overflow-x-auto rounded-card border border-line bg-surface-light p-4 font-mono text-xs leading-relaxed text-ink";
// scroll-mt-24 keeps anchored headings clear of the sticky header (as on how-it-works).
const h2Class = "scroll-mt-24 font-display text-lg font-bold text-ink-strong";
const h3Class = "font-semibold text-ink-strong";

export default function DevelopersPage() {
  const api = apiBaseUrl();
  return (
    <PageShell
      title="Developers"
      description="The NANDA Index has a REST API. Public reads need no key; writes use the session token from sign-in."
    >
      <div className="max-w-3xl space-y-10 text-sm leading-relaxed text-ink-medium">
        <section aria-labelledby="dev-reference" className="space-y-3">
          <h2 id="dev-reference" className={h2Class}>Reference</h2>
          <p>
            API base URL: <code className="font-mono text-ink">{api}</code>. Every route is described in the{" "}
            <a href={apiDocsUrl(api)} target="_blank" rel="noopener noreferrer" className={linkClass}>
              API reference (Swagger UI)
            </a>
            , generated from the server&apos;s own route schemas; the{" "}
            <a href={openApiUrl(api)} target="_blank" rel="noopener noreferrer" className={linkClass}>
              OpenAPI document
            </a>{" "}
            behind it can feed a code generator. The{" "}
            <a href={externalLinks.github} target="_blank" rel="noopener noreferrer" className={linkClass}>
              source and README
            </a>{" "}
            cover self-hosting. Identifiers follow the ARD form{" "}
            <code className="font-mono text-ink">urn:air:&lt;publisher-FQDN&gt;:&lt;namespace...&gt;:&lt;short-name&gt;</code>;
            see <Link href="/how-it-works" className={linkClass}>How it works</Link> for the model.
          </p>
        </section>

        <section aria-labelledby="dev-quickstart" className="space-y-5">
          <h2 id="dev-quickstart" className={h2Class}>Quickstart: read the index</h2>
          {QUICKSTART.map((step) => (
            <div key={step.id} id={`quickstart-${step.id}`} className="scroll-mt-24 space-y-2">
              <h3 className={h3Class}>{step.title}</h3>
              <p>{step.note}</p>
              <pre className={preClass} tabIndex={0}>{step.command(api)}</pre>
              {step.response && <pre className={preClass} tabIndex={0}>{step.response}</pre>}
            </div>
          ))}
          <p>
            Every public response is JSON. Entries from resolve and index use camelCase AI Catalog fields; search
            results use the snake_case owner record.
          </p>
        </section>

        <section aria-labelledby="dev-lifecycle" className="space-y-5">
          <h2 id="dev-lifecycle" className={h2Class}>Register, verify, update, delete</h2>
          <p>
            The same flow the dashboard uses, as API calls. The web app at{" "}
            <Link href="/dashboard/orgs/new" className={linkClass}>Register</Link> is the easier path if you only
            have one entry.
          </p>
          <ol className="list-decimal space-y-5 pl-6">
            {LIFECYCLE.map((step) => (
              <li key={step.title} className="space-y-2">
                <h3 className={h3Class}>{step.title}</h3>
                <p>{step.body}</p>
                <pre className={preClass} tabIndex={0}>{step.command(api)}</pre>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="dev-limits" className="space-y-3">
          <h2 id="dev-limits" className={h2Class}>Rate limits</h2>
          <p>
            Defaults for this index; an operator can change them. Each limited route has its own per-IP budget,
            so hitting the limit on one route does not block the others. Over a route limit, the API answers 429 with a
            Retry-After header (seconds) and X-RateLimit-Limit, X-RateLimit-Remaining and X-RateLimit-Reset
            headers; the body&apos;s error text says how long to wait, for example &quot;retry in 1 minute&quot;.
            The 429 codes below that the application raises itself (TOO_MANY_ATTEMPTS, TOO_MANY_UNVERIFIED,
            RESEND_COOLDOWN) carry no Retry-After header; the claim route&apos;s per-account limit does. Request
            bodies are capped at 64 KB (413).
          </p>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-xs font-semibold uppercase tracking-wide text-ink-weak">
                <th scope="col" className="py-2 pr-4">Routes</th>
                <th scope="col" className="py-2">Limit</th>
              </tr>
            </thead>
            <tbody>
              {RATE_LIMITS.map((row) => (
                <tr key={row.routes} className="border-b border-line/70 align-top">
                  <td className="py-2 pr-4">{row.routes}</td>
                  <td className="py-2">{row.limit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="dev-errors" className="space-y-3">
          <h2 id="dev-errors" className={h2Class}>Errors</h2>
          <p>
            Errors are JSON: <code className="font-mono text-ink">{`{ "error": "<code>", "detail": "<message>" }`}</code>.
            Server failures answer 500 with <code className="font-mono text-ink">internal_server_error</code> and no
            detail. Codes are quoted exactly as the API sends them.
          </p>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-xs font-semibold uppercase tracking-wide text-ink-weak">
                <th scope="col" className="py-2 pr-4">Status</th>
                <th scope="col" className="py-2 pr-4">Code</th>
                <th scope="col" className="py-2">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {ERROR_CODES.map((row) => (
                <tr key={row.code} className="border-b border-line/70 align-top">
                  <td className="py-2 pr-4 tabular-nums">{row.status}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-ink">{row.code}</td>
                  <td className="py-2">{row.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </PageShell>
  );
}
