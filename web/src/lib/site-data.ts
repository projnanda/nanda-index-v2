export const navigation = [
  { href: "/", label: "Overview" },
  { href: "/registries", label: "Browse" },
  { href: "/resolve", label: "Resolve" },
  { href: "/query", label: "Agent Query" },
  { href: "/login", label: "Login" },
  { href: "/dashboard", label: "Dashboard" },
];

export const heroStats = [
  { value: "3", label: "registered organizations" },
  { value: "3", label: "active / verified" },
  { value: "2026041103", label: "root serial" },
  { value: "24h", label: "default TTL" },
];

export const whatNandaIndexIs = [
  "A global switchboard for federated agent resolution",
  "An AI Catalog-formatted index of resolution records",
  "A bridge between discovery islands — AI Catalog, DNS-AID, gateways, and personal agent cards",
  "A resolver mapping any identity (domain, email, URN) to the correct next discovery object",
];

export const whatNandaIndexIsNot = [
  "A replacement for AI Catalog, DNS-AID, or any other discovery system",
  "Required when enterprise-to-enterprise AI Catalog discovery works natively",
  "An agent executor or marketplace",
  "An identity authority or DNS root",
];

export const architectureLayers = [
  {
    layer: "Enterprise",
    function: "Exposes agents via AI Catalog, DNS-AID, or gateways",
    analogy: "urn:ai:domain:example.com",
    hosted: "Optional — fallback and anti-squatting",
  },
  {
    layer: "SMB",
    function: "Agent runtime on AWS/GCP; agent card hosted by a third party",
    analogy: "orders@moonbakery.com",
    hosted: "Primary resolver via NandaIndex",
  },
  {
    layer: "Individual",
    function: "No domain needed; email identity with delegated card hosting",
    analogy: "john@hotmail.com",
    hosted: "Primary resolver via NandaIndex",
  },
];
