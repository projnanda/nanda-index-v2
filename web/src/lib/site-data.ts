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
  // Self-hosted PDF served by Caddy directly (see Caddyfile), not an IETF submission.
  paper: "https://nandaindex.org/paper.pdf",
  ardSpec: "https://agenticresourcediscovery.org/",
};

export const heroStats = [
  { value: "4", label: "registration types" },
  { value: "3", label: "resolution hops" },
  { value: "24h", label: "default TTL" },
  { value: "open", label: "identity scheme" },
];

export const architectureLayers = [
  {
    layer: "Enterprise",
    function: "Exposes agents via AI Catalog, DNS-AID, or gateways",
    analogy: "urn:ai:domain:example.com",
    hosted: "Optional: fallback and federation",
  },
  {
    layer: "SMB",
    function: "Agent runtime on AWS/GCP; agent card hosted by a third party",
    analogy: "urn:ai:domain:moonbakery39.com:agent:orders",
    hosted: "Primary resolver via NandaIndex",
  },
  {
    layer: "Individual",
    function: "No domain needed; email identity with delegated card hosting",
    analogy: "urn:ai:email:john@hotmail.com",
    hosted: "Primary resolver via NandaIndex",
  },
];
