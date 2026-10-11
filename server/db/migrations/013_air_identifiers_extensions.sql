-- 013: align stored index records with the updated switchboard paper
-- ("A Global Switchboard for the Agentic Web", IndexAICatalog revision).
--
--   * Identifiers move from the illustrative urn:ai:* forms to ARD's
--     domain-anchored urn:air:<publisher-FQDN>:<namespace...>:<short-name>.
--     Domain rows are anchored to their own (verified) domain; personal rows
--     are anchored to the card host: urn:air:host39.org:personal:<email-slug>.
--   * Flat "org.projectnanda.<key>" metadata keys become a namespaced AI
--     Catalog `extensions` object: { "org.projectnanda": { "<key>": ... } }.
--   * publisher.identifier becomes the bare publisher domain; personal rows
--     are published by Host39, with the account email as subjectAccount.
--   * DNS-AID is retired in favour of standard DNS service discovery (SVCB):
--     vnd.dns-aid entries become A2A Agent Card entries with a dns-svcb role,
--     and their DNS-AID-specific entry_data is dropped.
--
-- Clean break: nothing in the API reads the old forms after this migration.

ALTER TABLE organizations RENAME COLUMN catalog_metadata TO extensions;

-- 0. A blank domain means "no domain" (older API versions stored '' for
--    personal registrations). Normalise it so those rows take the host39 path
--    below instead of getting an empty publisher anchor (urn:air::...).
UPDATE organizations SET domain = NULL WHERE btrim(domain) = '';

-- 1. Flat org.projectnanda.* keys → nested extension namespace.
--    ('org.projectnanda.' is 17 characters, so the bare key starts at 18.)
UPDATE organizations o
   SET extensions = (
     SELECT (o.extensions - coalesce(array_agg(e.key) FILTER (WHERE e.key LIKE 'org.projectnanda.%'), '{}'))
            || jsonb_build_object(
                 'org.projectnanda',
                 coalesce(o.extensions -> 'org.projectnanda', '{}'::jsonb)
                 || coalesce(jsonb_object_agg(substr(e.key, 18), e.value)
                               FILTER (WHERE e.key LIKE 'org.projectnanda.%'), '{}'::jsonb))
       FROM jsonb_each(o.extensions) AS e
   )
 WHERE o.extensions IS NOT NULL
   AND jsonb_typeof(o.extensions) = 'object'
   AND EXISTS (SELECT 1 FROM jsonb_object_keys(o.extensions) k WHERE k LIKE 'org.projectnanda.%');

UPDATE organizations
   SET extensions = '{"org.projectnanda": {}}'::jsonb
 WHERE extensions IS NULL OR jsonb_typeof(extensions) <> 'object';

UPDATE organizations
   SET extensions = extensions || '{"org.projectnanda": {}}'::jsonb
 WHERE jsonb_typeof(extensions -> 'org.projectnanda') IS DISTINCT FROM 'object';

-- 2. DNS-AID → DNS-based service discovery (SVCB).
UPDATE organizations
   SET media_type = 'application/a2a-agent-card+json',
       entry_data = NULL,
       tags       = array_replace(tags, 'dns-aid', 'dns-svcb')
 WHERE media_type = 'application/vnd.dns-aid+json';

UPDATE organizations
   SET extensions = jsonb_set(
         extensions, '{org.projectnanda}',
         (extensions -> 'org.projectnanda')
         || jsonb_build_object(
              'resolutionRole',      'dns-svcb-pointer',
              'preferredDiscovery',  'dns-svcb',
              'authoritativeSystem', lower(domain) || ' DNS'))
 WHERE extensions -> 'org.projectnanda' ->> 'preferredDiscovery' = 'dns-aid'
    OR extensions -> 'org.projectnanda' ->> 'resolutionRole'     = 'dns-aid-pointer';

-- 3. Personal (no-domain) rows: host-anchored identifier whose short-name is
--    the email itself (urn:air:host39.org:personal:john@hotmail.com), Host39
--    publisher, the account email carried as subjectAccount. Mirrors
--    emailSegment() in src/lib/airUrn.ts: lowercase, URN-safe characters kept,
--    everything else percent-encoded as UTF-8 — reversible, so collision-free.
CREATE FUNCTION pg_temp.air_email_segment(email text) RETURNS text AS $$
  SELECT coalesce(string_agg(
           CASE WHEN c.ch ~ '^[a-z0-9._~!$&''()*+,;=@-]$' THEN c.ch
                ELSE (SELECT string_agg('%' || upper(lpad(to_hex(get_byte(convert_to(c.ch, 'UTF8'), i)), 2, '0')), '' ORDER BY i)
                        FROM generate_series(0, octet_length(convert_to(c.ch, 'UTF8')) - 1) AS i)
           END, '' ORDER BY c.ord), '')
    FROM regexp_split_to_table(lower(trim(email)), '') WITH ORDINALITY AS c(ch, ord)
$$ LANGUAGE sql IMMUTABLE;

WITH personal AS (
  SELECT id,
         lower(CASE WHEN identifier ILIKE 'urn:ai:email:%' THEN substr(identifier, 14)
                    ELSE contact_email END) AS email
    FROM organizations
   WHERE domain IS NULL
)
UPDATE organizations o
   SET identifier = 'urn:air:host39.org:personal:' || pg_temp.air_email_segment(p.email),
       publisher  = '{"identifier": "host39.org", "displayName": "Host39", "identityType": "dns"}'::jsonb,
       extensions = jsonb_set(
         o.extensions, '{org.projectnanda}',
         (o.extensions -> 'org.projectnanda')
         || jsonb_build_object('subjectAccount', p.email, 'resolutionRole', 'personal-agent-card',
                               'preferredDiscovery', 'nandaindex'))
  FROM personal p
 WHERE o.id = p.id;

-- 4. Domain rows: anchor to the row's own domain. Catalog/registry entries
--    are the publisher's root; other entries keep the namespace path their
--    old identifier carried, else default to agent:<org_id>. (A legacy
--    urn:ai:<d>:<slug> on a catalog row named an agent *inside* that
--    catalog, not the entry itself, so it does not survive.)
WITH parsed AS (
  SELECT id,
         lower(domain) AS fqdn,
         CASE
           WHEN media_type = 'application/ai-catalog+json'  THEN 'catalog:root'
           WHEN media_type = 'application/ai-registry+json' THEN 'registry:root'
           -- urn:ai:domain:<d>:<ns>:<name>
           WHEN identifier ~* '^urn:ai:domain:[^:]+:[^:]+:[^:]+$'
             THEN regexp_replace(identifier, '^urn:ai:domain:[^:]+:', '', 'i')
           ELSE 'agent:' || org_id
         END AS path
    FROM organizations
   WHERE domain IS NOT NULL
     AND (identifier IS NULL OR identifier NOT ILIKE 'urn:air:%')
)
UPDATE organizations o
   SET identifier = 'urn:air:' || p.fqdn || ':' || regexp_replace(p.path, '[^A-Za-z0-9._~:-]+', '-', 'g')
  FROM parsed p
 WHERE o.id = p.id;

UPDATE organizations
   SET publisher = jsonb_build_object(
         'identifier',   lower(domain),
         'displayName',  coalesce(publisher ->> 'displayName', display_name),
         'identityType', 'dns')
 WHERE domain IS NOT NULL;

-- 5. Resolve collisions before the unique index: distinct emails can share a
--    slug (a.b@x.com / a-b@x.com) and mixed-case duplicate domains lower to
--    the same FQDN. The oldest row keeps the identifier; later rows get their
--    org_id appended to the short-name.
WITH ranked AS (
  SELECT id, org_id,
         row_number() OVER (PARTITION BY identifier ORDER BY created_at, org_id) AS n
    FROM organizations
)
UPDATE organizations o
   SET identifier = o.identifier || '-' || r.org_id
  FROM ranked r
 WHERE o.id = r.id AND r.n > 1;

-- 6. Every entry is now keyed on its identifier.
ALTER TABLE organizations ALTER COLUMN identifier SET NOT NULL;
ALTER TABLE organizations ALTER COLUMN extensions SET DEFAULT '{"org.projectnanda": {}}'::jsonb;
ALTER TABLE organizations ALTER COLUMN extensions SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_identifier ON organizations(identifier);

-- 7. Every entry belongs to exactly one anchor: its own domain (enterprise /
--    SMB / DNS-SVCB) or, with no domain, the host39 card host. Nothing may be
--    stored with a blank domain or an identifier anchored anywhere else.
ALTER TABLE organizations
  ADD CONSTRAINT organizations_domain_not_blank
    CHECK (domain IS NULL OR btrim(domain) <> ''),
  ADD CONSTRAINT organizations_identifier_anchored
    CHECK (
      (domain IS NULL     AND identifier LIKE 'urn:air:host39.org:%')
   OR (domain IS NOT NULL AND identifier LIKE 'urn:air:' || lower(domain) || ':%')
    );
