export const navigation = [
  { href: "/", label: "Home" },
  { href: "/explore", label: "Explore" },
  { href: "/query", label: "Discover" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/ongoing-projects", label: "Ongoing Projects" },
  { href: "/resolve", label: "Resolve" },
  { href: "/login", label: "Login" },
  { href: "/dashboard", label: "Dashboard" },
];

// Links out to project resources, surfaced on the homepage.
export const externalLinks = {
  github: "https://github.com/projnanda/nanda-index-v2",
  // Self-hosted PDF served by Caddy directly (see Caddyfile).
  paper: "https://nandaindex.org/paper.pdf",
  ietfDraft: "https://datatracker.ietf.org/doc/draft-raskar-agentic-web-federated-resolution/01/",
  ardSpec: "https://agenticresourcediscovery.org/",
  host39: "https://host39.org",
};

export const heroStats = [
  { value: "4", label: "registration types" },
  { value: "3", label: "resolution hops" },
  { value: "24h", label: "default TTL" },
  { value: "urn:air", label: "identifier scheme" },
];

export const architectureLayers = [
  {
    layer: "Enterprise",
    function: "Exposes agents via AI Catalog, DNS-based service discovery (SVCB), or gateways",
    analogy: "urn:air:example.com:catalog:root",
    hosted: "Optional: fallback and federation",
  },
  {
    layer: "SMB",
    function: "Agent runtime on AWS/GCP; agent card hosted by a third party",
    analogy: "urn:air:moonbakery.com:agent:orders",
    hosted: "Primary resolver via NandaIndex",
  },
  {
    layer: "Individual",
    function: "No domain needed; identifier anchored to the card host, email as subject account",
    analogy: "urn:air:host39.org:personal:john@hotmail.com",
    hosted: "Primary resolver via NandaIndex",
  },
];
