"use client";

import { useState } from "react";
import {
  ApiError,
  resolveAgent,
  fetchAgentRecord,
  fetchFactsUrl,
  createRegistryAgent,
} from "@/lib/nanda-api";
import type { ResolveResponse, CatalogEntry } from "@/lib/nanda-types";

// ── Small helpers ─────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-slate-500 mb-1">
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        "w-full rounded-xl border border-black/10 bg-white px-3 py-2 font-mono text-sm outline-none " +
        "focus:ring-2 focus:ring-slate-300 disabled:bg-slate-50 disabled:text-slate-400 " +
        (props.className ?? "")
      }
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      rows={4}
      className={
        "w-full rounded-xl border border-black/10 bg-white px-3 py-2 font-mono text-xs outline-none " +
        "focus:ring-2 focus:ring-slate-300 resize-none " +
        (props.className ?? "")
      }
    />
  );
}

function HopBadge({ n, label, url }: { n: number; label: string; url: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-950 text-white text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-700">{label}</p>
        <p className="font-mono text-xs text-slate-400 break-all">{url}</p>
      </div>
    </div>
  );
}

type HopState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: unknown }
  | { status: "error"; message: string };

function HopResult({ hop }: { hop: HopState }) {
  if (hop.status === "idle") return null;
  if (hop.status === "loading")
    return <p className="text-xs text-slate-400 animate-pulse">Fetching…</p>;
  if (hop.status === "error")
    return (
      <p className="text-xs text-rose-600 break-all">{hop.message}</p>
    );
  return (
    <Textarea
      readOnly
      value={JSON.stringify(hop.data, null, 2)}
      className="bg-slate-50 text-slate-700"
    />
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const DEFAULT_REGISTRY = "http://localhost:3002";
const DEFAULT_TOKEN    = "dev-token-change-in-production";
const DEFAULT_LOCATOR  = "urn:ai:domain:acme.com:agent:time";

export default function DemoPage() {
  // ── Register panel state ─────────────────────────────────────────────────

  const [registryUrl, setRegistryUrl] = useState(DEFAULT_REGISTRY);
  const [adminToken, setAdminToken]   = useState(DEFAULT_TOKEN);
  const [agentId, setAgentId]         = useState("ankit");
  const [displayName, setDisplayName] = useState("Ankit");
  const [agentUrl, setAgentUrl]       = useState("https://nasiko.com/.well-known/agents/ankit.json");
  const [mediaType, setMediaType]     = useState("application/a2a-agent-card+json");
  const [description, setDescription] = useState("");
  const [tags, setTags]               = useState("");
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered]   = useState<CatalogEntry | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);

  // ── Resolve panel state ──────────────────────────────────────────────────

  const [locator, setLocator] = useState(DEFAULT_LOCATOR);
  const [resolving, setResolving] = useState(false);

  const [hop1Url, setHop1Url]   = useState("");
  const [hop2Url, setHop2Url]   = useState("");
  const [hop3Url, setHop3Url]   = useState("");

  const [hop1, setHop1] = useState<HopState>({ status: "idle" });
  const [hop2, setHop2] = useState<HopState>({ status: "idle" });
  const [hop3, setHop3] = useState<HopState>({ status: "idle" });

  // Talk with agent state
  const [agentEndpoint, setAgentEndpoint] = useState("");
  const [taskMessage, setTaskMessage]     = useState("what time is it?");
  const [talking, setTalking]             = useState(false);
  const [talkResult, setTalkResult]       = useState<HopState>({ status: "idle" });

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegistering(true);
    setRegistered(null);
    setRegisterError(null);
    try {
      const entry = await createRegistryAgent(registryUrl, adminToken, {
        agent_id:     agentId,
        display_name: displayName,
        url:          agentUrl,
        media_type:   mediaType || undefined,
        description:  description || undefined,
        tags:         tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      });
      setRegistered(entry);
    } catch (err) {
      setRegisterError(
        err instanceof ApiError ? err.message : "Registration failed.",
      );
    } finally {
      setRegistering(false);
    }
  }

  async function onResolve(e: React.FormEvent) {
    e.preventDefault();
    if (!locator.trim()) return;

    setResolving(true);
    setHop1({ status: "idle" });
    setHop2({ status: "idle" });
    setHop3({ status: "idle" });
    setHop1Url("");
    setHop2Url("");
    setHop3Url("");
    setAgentEndpoint("");
    setTalkResult({ status: "idle" });

    // Hop 1 — NANDA Index
    const h1url = `${process.env.NEXT_PUBLIC_NANDA_INDEX_API_URL ?? "http://localhost:3001"}/api/v1/resolve?locator=${encodeURIComponent(locator.trim())}`;
    setHop1Url(h1url);
    setHop1({ status: "loading" });

    let indexResult: ResolveResponse;
    try {
      indexResult = await resolveAgent(locator.trim());
      setHop1({ status: "ok", data: indexResult });
    } catch (err) {
      setHop1({
        status: "error",
        message: err instanceof ApiError ? err.message : "NANDA Index lookup failed.",
      });
      setResolving(false);
      return;
    }

    // Hop 2 — Registry Server
    const { registry_url } = indexResult.index_record;
    if (!registry_url) {
      setHop2({ status: "error", message: "This entry has no registry URL (DNS-AID or custom discovery)." });
      setResolving(false);
      return;
    }
    const mediaType = indexResult.index_record.media_type;
    const isDirectCard = mediaType === "application/a2a-agent-card+json";
    const h2url = isDirectCard
      ? registry_url
      : `${registry_url.replace(/\/+$/, "")}/agents/${indexResult.identifier}`;
    setHop2Url(h2url);
    setHop2({ status: "loading" });

    let catalogEntry: CatalogEntry;
    try {
      catalogEntry = await fetchAgentRecord(registry_url, indexResult.identifier, mediaType);
      setHop2({ status: "ok", data: catalogEntry });
    } catch (err) {
      setHop2({
        status: "error",
        message: err instanceof ApiError ? err.message : "Registry Server unreachable.",
      });
      setResolving(false);
      return;
    }

    // Hop 3 — Agent facts URL
    const h3url = catalogEntry.url;
    setHop3Url(h3url);
    setHop3({ status: "loading" });

    try {
      const facts = await fetchFactsUrl(h3url);
      setHop3({ status: "ok", data: facts });
      // Extract agent runtime endpoint from the facts doc
      const endpoint = (facts as Record<string, unknown>)?.url as string | undefined;
      if (endpoint) setAgentEndpoint(endpoint);
    } catch (err) {
      setHop3({
        status: "error",
        message:
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : "Could not fetch facts URL — the host may not be running or CORS may block browser access.",
      });
    } finally {
      setResolving(false);
    }
  }

  async function onTalk(e: React.FormEvent) {
    e.preventDefault();
    if (!agentEndpoint) return;
    setTalking(true);
    setTalkResult({ status: "loading" });
    try {
      const runUrl = `${agentEndpoint.replace(/\/+$/, "")}/run`;
      const res = await fetch(runUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `task-${Date.now()}`,
          message: { role: "user", parts: [{ text: taskMessage }] },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      setTalkResult({ status: "ok", data });
    } catch (err) {
      setTalkResult({
        status: "error",
        message: err instanceof Error ? err.message : "Agent invocation failed.",
      });
    } finally {
      setTalking(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-3">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
            NANDA Demo
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Register an agent into a Registry Server, then resolve it end-to-end across all 3 hops.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6 items-start">

          {/* ── Panel A: Register Agent ─────────────────────────────────────── */}
          <section className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Step 1
              </p>
              <h2 className="text-base font-semibold text-slate-950 mt-0.5">
                Register Agent into Registry
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                The org runs their own Registry Server. This form calls{" "}
                <span className="font-mono">POST /agents</span> on it.
              </p>
            </div>

            <form onSubmit={onRegister} className="space-y-4">
              {/* Connection */}
              <div className="rounded-2xl bg-slate-50 p-4 space-y-3">
                <p className="text-xs font-medium text-slate-500">Registry connection</p>
                <div>
                  <Label>Registry URL</Label>
                  <Input
                    value={registryUrl}
                    onChange={(e) => setRegistryUrl(e.target.value)}
                    placeholder="http://localhost:3002"
                  />
                </div>
                <div>
                  <Label>Admin token</Label>
                  <Input
                    type="password"
                    value={adminToken}
                    onChange={(e) => setAdminToken(e.target.value)}
                    placeholder="REGISTRY_ADMIN_TOKEN"
                  />
                </div>
              </div>

              {/* Agent fields */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>agent_id (local slug)</Label>
                    <Input
                      value={agentId}
                      onChange={(e) => setAgentId(e.target.value)}
                      placeholder="ankit"
                      required
                    />
                  </div>
                  <div>
                    <Label>display_name</Label>
                    <Input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Ankit"
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label>url — facts / A2A card URL (hop 3 target)</Label>
                  <Input
                    value={agentUrl}
                    onChange={(e) => setAgentUrl(e.target.value)}
                    placeholder="https://nasiko.com/.well-known/agents/ankit.json"
                    required
                  />
                </div>

                <div>
                  <Label>media_type</Label>
                  <Input
                    value={mediaType}
                    onChange={(e) => setMediaType(e.target.value)}
                    placeholder="application/a2a-agent-card+json"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>description (optional)</Label>
                    <Input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="What this agent does"
                    />
                  </div>
                  <div>
                    <Label>tags (comma-separated)</Label>
                    <Input
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                      placeholder="search, summarise"
                    />
                  </div>
                </div>
              </div>

              {registerError && (
                <p className="text-xs text-rose-600 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2">
                  {registerError}
                </p>
              )}

              <button
                type="submit"
                disabled={registering}
                className="w-full rounded-2xl bg-slate-950 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              >
                {registering ? "Registering…" : "Register Agent"}
              </button>
            </form>

            {/* Success */}
            {registered && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
                <p className="text-xs font-semibold text-emerald-700">
                  Registered — URN for resolution:
                </p>
                <p className="font-mono text-sm text-slate-950 break-all">
                  urn:ai:&lt;your-domain&gt;:{registered.identifier}
                </p>
                <Textarea
                  readOnly
                  value={JSON.stringify(registered, null, 2)}
                  className="bg-white text-slate-700 mt-2"
                />
              </div>
            )}
          </section>

          {/* ── Panel B: 3-Hop Resolver ─────────────────────────────────────── */}
          <section className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Step 2
              </p>
              <h2 className="text-base font-semibold text-slate-950 mt-0.5">
                Resolve Agent (3 hops)
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Enter a URN locator. Each hop runs sequentially and shows the live response.
              </p>
            </div>

            <form onSubmit={onResolve} className="flex gap-2">
              <Input
                value={locator}
                onChange={(e) => setLocator(e.target.value)}
                placeholder="urn:ai:nasiko.com:ankit"
                className="flex-1"
              />
              <button
                type="submit"
                disabled={resolving || !locator.trim()}
                className="shrink-0 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {resolving ? "…" : "Resolve"}
              </button>
            </form>

            {/* Hops */}
            <div className="space-y-5">

              {/* Hop 1 */}
              <div className="space-y-2">
                <HopBadge
                  n={1}
                  label="NANDA Index — who manages this domain?"
                  url={hop1Url || "GET <nanda-index>/api/v1/resolve?locator=…"}
                />
                <div className="ml-9">
                  <HopResult hop={hop1} />
                </div>
              </div>

              {hop1.status !== "idle" && (
                <div className="ml-3 border-l-2 border-dashed border-slate-200 pl-6 space-y-5">

                  {/* Hop 2 */}
                  <div className="space-y-2">
                    <HopBadge
                      n={2}
                      label="Registry Server — what is this agent's facts URL?"
                      url={hop2Url || "GET <registry_url>/agents/<identifier>"}
                    />
                    <div className="ml-9">
                      <HopResult hop={hop2} />
                    </div>
                  </div>

                  {hop2.status !== "idle" && (
                    <div className="space-y-5">
                      {/* Hop 3 */}
                      <div className="space-y-2">
                        <HopBadge
                          n={3}
                          label="Facts URL — agent capabilities & endpoint"
                          url={hop3Url || "GET <catalog_entry.url>"}
                        />
                        <div className="ml-9">
                          <HopResult hop={hop3} />
                          {hop3.status === "error" && (
                            <p className="mt-1 text-xs text-slate-400">
                              In production the agent caches this URL after the first successful fetch.
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Step 4 — Talk with agent */}
                      {hop3.status !== "idle" && (
                        <div className="space-y-2">
                          <HopBadge
                            n={4}
                            label="Talk with agent"
                            url={agentEndpoint ? `${agentEndpoint.replace(/\/+$/, "")}/run` : "POST <agent.url>/run"}
                          />
                          <div className="ml-9 space-y-2">
                            <form onSubmit={onTalk} className="flex gap-2">
                              <Input
                                value={taskMessage}
                                onChange={(e) => setTaskMessage(e.target.value)}
                                placeholder="what time is it?"
                                className="flex-1"
                                disabled={!agentEndpoint}
                              />
                              <button
                                type="submit"
                                disabled={talking || !agentEndpoint}
                                className="shrink-0 rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                              >
                                {talking ? "…" : "Send"}
                              </button>
                            </form>
                            {!agentEndpoint && hop3.status === "ok" && (
                              <p className="text-xs text-slate-400">Agent endpoint not found in facts doc.</p>
                            )}
                            <HopResult hop={talkResult} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
