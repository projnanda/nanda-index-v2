# index-v2-demo

A demo of [NANDA Index v2](../README.md). One agent finds other organisations'
agents through the index, puts a request to them, books a restaurant, and leaves
a signed record of what it did.

**Live:** [demoindex.stellarminds.ai](https://demoindex.stellarminds.ai/ui)

## The task

> Invite the CEO of Regentix and the chief scientist of AstroCity to lunch
> tomorrow. Find a time that works, book a restaurant, and keep a record.

Nothing tells the agent where those people are, which restaurant to use, or what
the answer is. It looks them up.

Nine services take part: two indexes, three organisation servers, two guest
agents, a restaurant, and this agent. The two indexes answer different
questions — one finds organisations and their agents, the other binds a name to
a key and resolves it to a current address. This agent is built on the official
[`a2a-sdk`](https://pypi.org/project/a2a-sdk/) and shares no code with any of
them, so every exchange is between separate implementations.

## How discovery works

Each guest is found by a different route, to show both.

**Regentix's CEO — through index v2**

1. `GET /api/v1/search?q=regentix` on the index returns the org record and its
   `registry_url`.
2. `GET <registry_url>/.well-known/ai-catalog.json` lists the org's agents.
3. Pick the entry whose tags claim `leadership`, then follow its card to the
   address the agent answers on.
4. `GET <address>/agentfacts.json` for the skills the agent claims itself.

**AstroCity's chief scientist — through a second index**

`GET /v1/resolve?id=<urn>` returns the endpoint that key currently claims. That
index binds a name to a key and holds no capability metadata, so it answers
"where is this agent" only.

Note the two surfaces on index v2: `/api/v1/search` is a keyword match over
`org_id`, `domain`, `display_name` and `identifier`, so a tag-only term like
`travel` misses it. `/api/v1/agentic-search` ranks tags and descriptions too and
fans out into agent-level results. This demo uses the keyword surface.

### Organisations and agents disagree

Each agent publishes its own skills as
[AgentFacts](https://github.com/projnanda/agentfacts-format)
(`urn:nanda:skill:orbital-analysis`). Its organisation also publishes a list of
its agents with its own idea of what they do, and across this estate the two do
not match — Regentix lists `architecture` and `positioning` for its CEO, and that
agent claims neither.

Search uses what the agent says. The org catalog is how you find agents, not the
authority on what they do. Where the two differ, both are reported.

## What it produces

Every step writes a signed receipt in [ARP](https://pypi.org/project/sm-arp/)
format, hash-chained, verifiable with the `arp verify` CLI without trusting this
agent. The host's authority to act is a signed
[DAT](https://pypi.org/project/sm-dat/) grant that the restaurant checks itself.

The run ends with a table held in all three names and the host's agreement
recorded. The guests have not answered, so the table is held and not booked —
the demo reports that rather than a booking it made up.

## Run it

```bash
pip install -e .

PYTHONPATH=src python3 -m concierge register   # claim the name the restaurant checks
PYTHONPATH=src python3 -m concierge run        # one run; writes receipts/
PYTHONPATH=src python3 -m concierge serve      # serve the page and the agent card
PYTHONPATH=src python3 tools/ci.py             # lint, types, tests, coverage
```

Defaults point at the live hosted services, so a clean checkout runs without
configuration. The test suite runs offline.

## Configuration

Copy `.env.example` and set what you need.

| Variable | Meaning |
|---|---|
| `CONCIERGE_HOME` | where the signing key lives. Use a persistent volume — the agent's name comes from its key, so losing it means becoming someone else |
| `CONCIERGE_BASE_URL` | this agent's own address; its card and its index entry are both built from it |
| `PUBLIC_INDEX_URL` | the index v2 used for search (default `https://api.nandaindex.org`) |
| `CONCIERGE_INDEX_URL` | the second index, which the restaurant checks callers against |
| `VENUE_URL` | the restaurant |
| `REGENTIX_SERVER_URL`, `ASTROCITY_SERVER_URL`, `ROCKETBRAIN_SERVER_URL` | the three organisation servers |
| `REGENTIX_CEO_URL`, `ASTROCITY_SCIENCE_URL` | guest addresses, used if discovery fails and recorded as configured |
| `LUNCH_DATE`, `LUNCH_STARTS` | the date and the sittings to try |
| `CONCIERGE_RECEIPTS` | where `run` writes each chain (default `receipts/`) |

## Notes for anyone building a client

- **A2A does not say which path carries the agent surface.** Here the per-agent
  services answer JSON-RPC on `/` and the organisation servers answer it on
  `/a2a`. Name it per counterparty; don't infer it.
- **Nor does it say which `Part` a counterparty will parse.** The agents want a
  `DataPart` of `{tool, args}`; the restaurant wants a `TextPart` whose text is
  JSON. A message whose parts are all ignored looks empty, not malformed.
- **Signing is versioned.** v0.2 signs `{body}:{agent_id}:{timestamp}`; v0.3
  signs `{METHOD}:{path}:{body}:{agent_id}:{timestamp}:{nonce}` and adds an
  `X-Agent-Nonce` header. The version is not derivable from the URL, so it is an
  explicit argument at every call site.
- **A signature is accountability, not membership.** It proves possession of a
  key. It does not open an org's member list, so naming an agent inside an
  organisation stays a configured hop for an outsider.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 stellarminds.ai.

This directory is licensed separately from the repository containing it: the
NANDA Index is Apache-2.0 (see the [root LICENSE](../LICENSE)); this demo is MIT.
