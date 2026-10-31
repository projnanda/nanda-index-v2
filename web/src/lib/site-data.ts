export const navigation = [
  { href: "/", label: "Home" },
  { href: "/contributors", label: "Contributors" },
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
  // Update the version when replacing the PDF to refresh cached downloads.
  paper: "https://nandaindex.org/paper.pdf?v=069ea34a2038",
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
    analogy: "urn:air:regentix.ai:catalog:root",
    hosted: "Optional: fallback and federation",
  },
  {
    layer: "SMB",
    function: "Agent runtime on AWS/GCP; agent card hosted by a third party",
    analogy: "urn:air:moonbakery39.com:agent:orders",
    hosted: "Primary resolver via NandaIndex",
  },
  {
    layer: "Individual",
    function: "No domain needed; identifier anchored to the card host, email as subject account",
    // Illustrative: real personal entries carry a real person's email.
    analogy: "urn:air:host39.org:personal:john@hotmail.com (illustrative)",
    hosted: "Primary resolver via NandaIndex",
  },
];
