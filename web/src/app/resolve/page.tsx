"use client";

import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { ApiError, resolveAgent, fetchAgentRecord, fetchFactsUrl } from "@/lib/nanda-api";
import type { ResolveResponse, CatalogEntry } from "@/lib/nanda-types";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type HopStatus = "idle" | "loading" | "ok" | "error" | "skipped";

interface HopState {
  status: HopStatus;
  url?: string;
  data?: unknown;
  error?: string;
}

const IDLE: HopState = { status: "idle" };

// ── Components ────────────────────────────────────────────────────────────────

function HopCard({
  n, label, subtitle, hop, children,
}: {
  n: number; label: string; subtitle: string; hop: HopState; children?: React.ReactNode;
}) {
  const colors: Record<HopStatus, string> = {
    idle:    "border-black/10 bg-white",
    loading: "border-indigo-200 bg-indigo-50",
    ok:      "border-emerald-200 bg-white",
    error:   "border-rose-200 bg-rose-50",
    skipped: "border-black/10 bg-slate-50",
  };
  const badgeColors: Record<HopStatus, string> = {
    idle:    "bg-slate-100 text-slate-400",
    loading: "bg-indigo-500 text-white animate-pulse",
    ok:      "bg-emerald-500 text-white",
    error:   "bg-rose-500 text-white",
    skipped: "bg-slate-200 text-slate-400",
  };

  return (
    <div className={cn("rounded-3xl border p-5 transition-colors", colors[hop.status])}>
      <div className="flex items-start gap-4">
        <div className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors",
          badgeColors[hop.status],
        )}>
          {hop.status === "ok" ? "✓" : hop.status === "error" ? "✕" : n}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-950">{label}</p>
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
          {hop.url && (
            <p className="mt-1 break-all font-mono text-[11px] text-slate-400">{hop.url}</p>
          )}
        </div>
      </div>

      {hop.status === "loading" && (
        <p className="ml-12 mt-3 text-xs text-indigo-500 animate-pulse">Fetching…</p>
      )}

      {hop.status === "error" && (
        <p className="ml-12 mt-3 text-sm text-rose-700">{hop.error}</p>
      )}

      {hop.status === "ok" && hop.data !== undefined && (
        <details className="ml-12 mt-3">
          <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-700">
            View response
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-2xl border border-black/5 bg-slate-950 p-4 text-xs text-slate-200">
            {JSON.stringify(hop.data, null, 2)}
          </pre>
        </details>
      )}

      {children && <div className="ml-12 mt-3">{children}</div>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ResolvePage() {
  const [locator, setLocator]   = useState("");
  const [resolving, setResolving] = useState(false);
  const [latency, setLatency]   = useState<number | null>(null);

  const [hop1, setHop1] = useState<HopState>(IDLE);
  const [hop2, setHop2] = useState<HopState>(IDLE);
  const [hop3, setHop3] = useState<HopState>(IDLE);
  const [hop4, setHop4] = useState<HopState>(IDLE);

  // Step 4 talk state
  const [agentRunUrl, setAgentRunUrl] = useState("");
  const [taskInput, setTaskInput]     = useState("what time is it?");
  const [talking, setTalking]         = useState(false);

  async function onResolve(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!locator.trim()) return;

    setResolving(true);
    setHop1(IDLE); setHop2(IDLE); setHop3(IDLE); setHop4(IDLE);
    setAgentRunUrl("");
    setLatency(null);
    const t0 = performance.now();

    // ── Hop 1: NANDA Index ────────────────────────────────────────────────
    const h1url = `/api/v1/resolve?locator=${encodeURIComponent(locator.trim())}`;
    setHop1({ status: "loading", url: `GET ${process.env.NEXT_PUBLIC_NANDA_INDEX_API_URL ?? ""}${h1url}` });

    let indexData: ResolveResponse;
    try {
      indexData = await resolveAgent(locator.trim());
      setHop1({ status: "ok", url: `GET ${process.env.NEXT_PUBLIC_NANDA_INDEX_API_URL ?? ""}${h1url}`, data: indexData });
    } catch (err) {
      setHop1({ status: "error", url: h1url, error: err instanceof ApiError ? err.message : "Index lookup failed." });
      setResolving(false);
      return;
    }

    // ── Hop 2: Registry ───────────────────────────────────────────────────
    const { registry_url, media_type } = indexData.index_record;

    if (!registry_url) {
      setHop2({ status: "skipped", url: "No registry URL — DNS-AID or custom discovery path." });
      setResolving(false);
      setLatency(Math.round(performance.now() - t0));
      return;
    }

    const isDirectCard = media_type === "application/a2a-agent-card+json";
    const h2url = isDirectCard
      ? registry_url
      : `${registry_url.replace(/\/+$/, "")}/agents/${indexData.identifier}`;

    setHop2({ status: "loading", url: `GET ${h2url}` });

    let catalogEntry: CatalogEntry;
    try {
      catalogEntry = await fetchAgentRecord(registry_url, indexData.identifier, media_type);
      setHop2({ status: "ok", url: `GET ${h2url}`, data: catalogEntry });
    } catch (err) {
      setHop2({ status: "error", url: h2url, error: err instanceof ApiError ? err.message : "Registry unreachable." });
      setResolving(false);
      setLatency(Math.round(performance.now() - t0));
      return;
    }

    // ── Hop 3: Agent facts URL ─────────────────────────────────────────────
    const h3url = catalogEntry.url;
    setHop3({ status: "loading", url: `GET ${h3url}` });

    let facts: unknown;
    try {
      facts = await fetchFactsUrl(h3url);
      setHop3({ status: "ok", url: `GET ${h3url}`, data: facts });
      // Extract runtime endpoint for hop 4
      const endpoint = (facts as Record<string, unknown>)?.url as string | undefined;
      if (endpoint) {
        const runUrl = `${endpoint.replace(/\/+$/, "")}/run`;
        setAgentRunUrl(runUrl);
        setHop4({ status: "idle", url: `POST ${runUrl}` });
      } else {
        setHop4({ status: "skipped", url: "No runtime URL found in agent card." });
      }
    } catch (err) {
      setHop3({
        status: "error",
        url: h3url,
        error: err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : "Could not fetch agent card — host may not be running or CORS blocked.",
      });
      setHop4({ status: "skipped" });
    }

    setLatency(Math.round(performance.now() - t0));
    setResolving(false);
  }

  async function onTalk(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!agentRunUrl) return;
    setTalking(true);
    setHop4((h) => ({ ...h, status: "loading" }));
    try {
      const res = await fetch(agentRunUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `task-${Date.now()}`,
          message: { role: "user", parts: [{ text: taskInput }] },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      setHop4({ status: "ok", url: `POST ${agentRunUrl}`, data });
    } catch (err) {
      setHop4({
        status: "error",
        url: `POST ${agentRunUrl}`,
        error: err instanceof Error ? err.message : "Agent invocation failed.",
      });
    } finally {
      setTalking(false);
    }
  }

  const anyActive = [hop1, hop2, hop3, hop4].some((h) => h.status !== "idle");

  return (
    <PageShell
      title="Resolve Agent"
      description="Enter a URN to trace the full resolution path — from index to registry to agent card to invocation."
    >
      {/* Search bar */}
      <form onSubmit={onResolve} className="mb-8 flex gap-3">
        <input
          value={locator}
          onChange={(e) => setLocator(e.target.value)}
          placeholder="urn:ai:domain:acme.com:agent:time"
          className="flex-1 rounded-2xl border border-black/10 bg-white px-5 py-3 font-mono text-sm outline-none focus:ring-2 focus:ring-slate-300"
        />
        <button
          type="submit"
          disabled={resolving || !locator.trim()}
          className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-medium text-white disabled:opacity-60"
        >
          {resolving ? "Resolving…" : "Resolve"}
        </button>
      </form>

      {latency !== null && (
        <p className="mb-4 text-xs text-slate-400">Hops 1–3 completed in {latency} ms</p>
      )}

      {/* Hops */}
      {anyActive && (
        <div className="space-y-3">
          {/* Connector line */}
          <div className="relative space-y-3">

            <HopCard
              n={1}
              label="NANDA Index"
              subtitle="Who manages this domain or identity? Returns an IndexRecord with a registry_url."
              hop={hop1}
            />

            {hop1.status !== "idle" && (
              <>
                <div className="mx-auto h-5 w-px bg-slate-200" />

                <HopCard
                  n={2}
                  label="Registry"
                  subtitle="What is this specific agent's facts URL? Returns a CatalogEntry."
                  hop={hop2}
                />

                {hop2.status !== "idle" && (
                  <>
                    <div className="mx-auto h-5 w-px bg-slate-200" />

                    <HopCard
                      n={3}
                      label="Agent Card"
                      subtitle="Full agent capabilities, authentication, skills, and runtime endpoint."
                      hop={hop3}
                    />

                    {hop3.status !== "idle" && (
                      <>
                        <div className="mx-auto h-5 w-px bg-slate-200" />

                        <HopCard
                          n={4}
                          label="Talk with agent"
                          subtitle="Send a task directly to the agent runtime."
                          hop={hop4}
                        >
                          {agentRunUrl && hop4.status !== "skipped" && (
                            <form onSubmit={onTalk} className="flex gap-2 mt-1">
                              <input
                                value={taskInput}
                                onChange={(e) => setTaskInput(e.target.value)}
                                placeholder="what time is it?"
                                className="flex-1 rounded-2xl border border-black/10 bg-white px-4 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-slate-300"
                              />
                              <button
                                type="submit"
                                disabled={talking}
                                className="rounded-2xl bg-emerald-700 px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
                              >
                                {talking ? "…" : "Send"}
                              </button>
                            </form>
                          )}
                        </HopCard>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {!anyActive && (
        <div className="rounded-3xl border border-black/10 bg-white p-8 text-center">
          <p className="text-sm text-slate-400">
            Enter a URN above to trace the resolution hops.
          </p>
          <p className="mt-2 font-mono text-xs text-slate-300">
            e.g. urn:ai:domain:acme.com:agent:time
          </p>
        </div>
      )}
    </PageShell>
  );
}
