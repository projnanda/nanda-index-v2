export const navigation = [
  { href: "/", label: "Overview" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/registries", label: "Browse" },
  { href: "/resolve", label: "Resolve" },
  { href: "/login", label: "Login" },
  { href: "/dashboard", label: "Dashboard" },
];

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
    hosted: "Optional — fallback and federation",
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
