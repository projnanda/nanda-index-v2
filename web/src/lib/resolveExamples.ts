import type { ResolveResponse } from "./nanda-types";

export const resolveExamples = [
  { kind: "catalog", label: "Catalog agent", identifier: "urn:air:nandaindex.org:demo:catalog-agent" },
  { kind: "smb", label: "SMB card", identifier: "urn:air:nandaindex.org:demo:smb-agent" },
  { kind: "personal", label: "Personal card", identifier: "urn:air:host39.org:personal:demo@example.invalid" },
] as const;
export type ExampleKind = (typeof resolveExamples)[number]["kind"];
export const isExampleKind = (value: unknown): value is ExampleKind => resolveExamples.some((example) => example.kind === value);

/** Repository-controlled HTTP fixtures, explicitly separate from the public index. */
export function exampleResponse(kind: string, path: string[], origin: string): unknown | null {
  const preset = resolveExamples.find((example) => example.kind === kind);
  if (!preset) return null;
  const base = `${origin}/api/resolve-examples/${kind}`;
  const catalog = kind === "catalog";
  const card = {
    name: `${preset.label} demonstration`, description: "Controlled demonstration hosted by this site. No external agent is invoked.",
    version: "1.0.0", protocolVersion: "0.3.0", url: `${base}/runtime`, capabilities: {},
    defaultInputModes: ["text"], defaultOutputModes: ["text"],
    skills: [{ id: "demo", name: "Demo response", description: "Returns a fixed demonstration response", tags: ["demo"] }],
  };
  const entry = { identifier: preset.identifier, displayName: card.name, mediaType: "application/a2a-agent-card+json", url: `${base}/card` };
  switch (path.join("/")) {
    case "index": return {
      locator: preset.identifier, identifier: "demo", match: catalog ? "publisher" : "exact",
      entry: { identifier: preset.identifier, displayName: card.name,
        type: catalog ? "application/ai-catalog+json" : "application/a2a-agent-card+json",
        url: catalog ? `${base}/registry` : `${base}/card`, tags: ["demonstration"], updatedAt: "2026-10-30T00:00:00.000Z",
        extensions: { "org.projectnanda": { demonstration: true, resolutionRole: catalog ? "nested-ai-catalog" : kind === "personal" ? "personal-agent-card" : "smb-agent-card" } },
      },
    } satisfies ResolveResponse;
    case "registry/agents/demo": return catalog ? entry : null;
    case "registry/agents": return catalog ? { specVersion: "1.0", entries: [entry] } : null;
    case "card": return card;
    default: return null;
  }
}
