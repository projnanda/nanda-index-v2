import { PERSONAL_CARD_HOST } from "@/lib/air";

/**
 * Info-tip copy for the org registration and edit forms — what each field is
 * and what to enter. Shared so both forms describe a field the same way.
 */
export const ORG_FIELD_HELP = {
  org_id:
    "A permanent, unique handle for your organization in the NANDA Index. It appears in your dashboard URL, is searchable, and becomes the default agent name in your identifier. Use 2–64 lowercase letters, numbers or hyphens, e.g. moon-bakery. It can't be changed later.",
  display_name:
    "The human-readable name people see in search results and on your dashboard, and one of the fields agent search matches against. Use your organization's, agent's or own name, e.g. Moon Bakery. Spaces and capitals are fine, and you can change it later.",
  domain:
    "A domain you own. Your agents are addressed under it (urn:air:<domain>:…), and you'll prove ownership with a DNS TXT record before the record goes live. Enter the bare hostname, e.g. moonbakery.com, not https://moonbakery.com.",
  identity_email:
    `Personal agents don't need a domain: this verified email is your identity and becomes part of your identifier (urn:air:${PERSONAL_CARD_HOST}:personal:<email>). We send a verification link here, so use an address you can receive mail at.`,
  catalog_url:
    "The public URL of your AI Catalog, the JSON file that lists your agents, usually https://<your-domain>/.well-known/ai-catalog.json. You can also enter the base URL of your nanda-registry server. Resolvers fetch it to discover your agents.",
  svcb_card_url:
    "The URL of the A2A Agent Card (a JSON file describing your agent) that your SVCB DNS records point to. The index stores it as a pointer; your DNS stays authoritative.",
  agent_card_url:
    `The URL of your A2A Agent Card, the JSON file describing your agent's skills and endpoint. Create the card on ${PERSONAL_CARD_HOST} first, then paste its URL here.`,
  registry_url:
    "Where resolvers fetch this record's details: your AI Catalog URL (usually https://<your-domain>/.well-known/ai-catalog.json) if you run a catalog, or your A2A Agent Card URL if you registered a single agent.",
  agent_id:
    "A short name for this agent under your domain, used in its identifier: urn:air:<domain>:agent:<id>, e.g. orders. Letters, numbers, dots, hyphens, underscores and tildes. Leave blank to use your Org ID.",
  runtime_provider:
    "The cloud or platform that runs your agent, e.g. AWS or Vercel. Stored as a hint on your record so callers know where requests go.",
  runtime_url:
    "The base URL of the running agent service that handles requests, e.g. https://my-agent.aws.example.com. Stored as a hint on your record.",
  auth_metadata:
    "How much of your agent's metadata is publicly readable, e.g. public or public_minimal. Stored as a hint on your record.",
  auth_execution:
    "What a caller must provide before invoking your agent, e.g. user_consent_required or payment_or_session_token_required. Stored as a hint on your record.",
  description:
    "A plain-language summary of what your agent or catalog does. Agent search matches against it, so name the tasks it handles, e.g. menu lookup, order placement, pickup scheduling.",
  tags:
    "Comma-separated keywords for your agent or catalog, e.g. bakery, orders, pickup. Agent search matches against them alongside the name and description.",
  version:
    "A free-text version label for this catalog or agent card, up to 64 characters, e.g. v1.0.0 or 2026-10. Shown on your listing card; update it when you publish changes.",
  identifier:
    "The permanent urn:air identifier resolvers use to look up your record. It's derived for you; override it only if you need a custom path, and it must stay under urn:air:<your-domain>:.",
  contact_email:
    "The address responsible for this registration. We email a link here to confirm it, so use an inbox your team monitors, e.g. admin@moonbakery.com.",
  ttl_seconds:
    "How long resolvers may cache your index record before fetching it again. Shorter means edits show up sooner; longer means fewer lookups. 24 hours suits most registrations.",
} as const;
