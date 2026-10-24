-- Load-test seed. Run by run.sh inside the db container:
--   psql -v orgs=50000 -v users=500 -f /seed/seed.sql
--
-- Idempotent: removes earlier load-test rows (org_id 'lt-%', emails
-- '@loadtest.example') and re-inserts them. Rows are deterministic from their
-- number, so k6 can address any org as lt-<n> without a shared data file.
--
-- Media-type mix (roughly what the live index holds):
--   n % 10 = 0  -> ai-catalog (enterprise): registry_url points at the stub
--                  registry, so agentic search fans out to it
--   n % 50 = 1  -> ai-registry (ARD finder): referred to, never fetched
--   n % 100 = 2 -> ANS pointer: excluded from agentic ranking
--   otherwise   -> A2A / MCP card: one agent, no outbound call

\set ON_ERROR_STOP on
\if :{?orgs}
\else
  \set orgs 100
\endif
\if :{?users}
\else
  \set users 200
\endif
\if :{?password}
\else
  \set password 'LoadTest-Passw0rd!'
\endif

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

BEGIN;

DELETE FROM organizations WHERE org_id LIKE 'lt-%';
DELETE FROM users WHERE email LIKE '%@loadtest.example';

WITH vocab AS (
  SELECT
    ARRAY['travel','payments','email','calendar','weather','legal','health',
          'shipping','analytics','support','recruiting','crm','security',
          'translation','finance','retail','education','insurance','realestate',
          'logistics'] AS cats,
    ARRAY['booking','invoicing','scheduling','search','tracking','reporting',
          'onboarding','compliance','forecasting','routing','summarization',
          'notifications'] AS tasks,
    ARRAY['small businesses','enterprises','developers','consumers','teams'] AS segs
),
numbered AS (
  SELECT
    n,
    'lt-' || n AS org_id,
    'lt-' || n || '.loadtest.example' AS domain,
    CASE
      WHEN n % 10 = 0  THEN 'application/ai-catalog+json'
      WHEN n % 50 = 1  THEN 'application/ai-registry+json'
      WHEN n % 100 = 2 THEN 'application/vnd.ans-registry+json'
      WHEN n % 2 = 0   THEN 'application/mcp-server-card+json'
      ELSE                  'application/a2a-agent-card+json'
    END AS media_type,
    vocab.cats[1 + n % 20]       AS cat,
    vocab.cats[1 + (n / 20) % 20] AS cat2,
    vocab.tasks[1 + n % 12]      AS task,
    vocab.segs[1 + n % 5]        AS seg
  FROM generate_series(1, :orgs) AS n, vocab
)
INSERT INTO organizations (
  org_id, display_name, domain, contact_email, registry_url,
  email_verified, status, identifier, media_type, description, tags,
  domain_verified, domain_verified_at, ever_proven, moderation,
  created_at, updated_at
)
SELECT
  org_id,
  initcap(cat) || ' ' || initcap(task) || ' ' || n,
  domain,
  'ops@' || domain,
  CASE
    WHEN media_type = 'application/ai-catalog+json'  THEN 'http://stub-registry:8090/' || domain
    WHEN media_type = 'application/ai-registry+json' THEN 'https://' || domain || '/api/ard'
    ELSE 'https://' || domain || '/.well-known/agent-card.json'
  END,
  TRUE,
  'active',
  'urn:air:' || domain || CASE
    WHEN media_type = 'application/ai-catalog+json' THEN ':catalog:root'
    ELSE ':agent:main'
  END,
  media_type,
  'Agent for ' || cat || ' ' || task || ' serving ' || seg
    || '. Also covers ' || cat2 || ' workflows.',
  ARRAY[cat, task, cat2],
  TRUE,
  now(),
  TRUE,
  'none',
  -- Spread creation times so listing order is stable and realistic.
  now() - make_interval(secs => :orgs - n),
  now() - make_interval(secs => :orgs - n)
FROM numbered;

-- One bcrypt hash (cost 10, the server's BCRYPT_ROUNDS) shared by every user:
-- a login costs the same CPU whichever user it is, and hashing once keeps the
-- seed fast. pgcrypto writes $2a$ hashes, which the server's bcrypt verifies.
WITH hash AS (SELECT crypt(:'password', gen_salt('bf', 10)) AS h)
INSERT INTO users (email, display_name, provider, provider_id, password_hash, email_verified)
SELECT
  'lt-user-' || n || '@loadtest.example',
  'Load Test User ' || n,
  'email',
  'lt-user-' || n || '@loadtest.example',
  hash.h,
  TRUE
FROM generate_series(1, :users) AS n, hash;

COMMIT;

-- VACUUM, not just ANALYZE: the bulk DELETE + INSERT leaves dead rows and a
-- GIN pending list (search_vector) that autovacuum would otherwise clean up
-- in the middle of the next run, inflating db CPU and search latency there.
VACUUM (ANALYZE) organizations;
VACUUM (ANALYZE) users;

SELECT
  (SELECT count(*) FROM organizations WHERE org_id LIKE 'lt-%') AS seeded_orgs,
  (SELECT count(*) FROM users WHERE email LIKE '%@loadtest.example') AS seeded_users;
