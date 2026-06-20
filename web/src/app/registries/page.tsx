"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { StatusBadge } from "@/components/StatusBadge";
import { JsonPanel } from "@/components/JsonPanel";
import { TableEmptyState } from "@/components/TableEmptyState";
import { ApiError, listIndexRecords } from "@/lib/nanda-api";
import { getAuthToken, isTokenExpired } from "@/lib/auth";
import type { IndexRecord, OrgStatus } from "@/lib/nanda-types";

export default function RegistriesPage() {
  const [statusFilter, setStatusFilter] = useState<OrgStatus | "all">("active");
  // Start false to match SSR; flip after mount to avoid hydration mismatch
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [items, setItems] = useState<IndexRecord[]>([]);
  const [selected, setSelected] = useState<IndexRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const data = await listIndexRecords();
      const filtered = statusFilter === "all" ? data : data.filter((r) => r.status === statusFilter);
      setItems(filtered);
      setSelected(filtered[0] ?? null);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.status}: ${err.message}`);
      else setError("Could not load index records.");
      setItems([]);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = getAuthToken();
    setIsLoggedIn(!!t && !isTokenExpired(t));
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  return (
    <PageShell
      title="Browse Organizations"
      description="All organizations registered in the NANDA Index."
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {(["active", "all", "pending", "suspended"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full border px-4 py-2 text-sm capitalize ${
              statusFilter === s
                ? "border-slate-950 bg-slate-950 text-white"
                : "border-black/10 bg-white"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm">
          Loading…
        </div>
      ) : error ? (
        <div className="mb-6 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
          {error}
        </div>
      ) : items.length === 0 ? (
        <TableEmptyState
          title="No organizations found"
          description="No organizations match the selected filter."
          actionLabel={isLoggedIn ? "Register your organization" : "Sign in to register"}
          actionHref={isLoggedIn ? "/dashboard/orgs/new" : "/login"}
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-3xl border border-black/10 bg-white shadow-sm">
            <table className="w-full table-fixed text-left">
              <colgroup>
                <col style={{ width: "35%" }} />
                <col style={{ width: "35%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "15%" }} />
              </colgroup>
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-4 py-4">Organization</th>
                  <th className="px-4 py-4">Domain</th>
                  <th className="px-4 py-4">Status</th>
                  <th className="px-4 py-4">Verified</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.org_id}
                    onClick={() => setSelected(item)}
                    className="cursor-pointer border-t hover:bg-slate-50"
                  >
                    <td className="px-4 py-4 align-top">
                      <div className="font-medium text-slate-950 break-words">{item.display_name}</div>
                      <div className="text-sm text-slate-500 break-all">{item.org_id}</div>
                    </td>
                    <td className="px-4 py-4 align-top break-all">{item.domain}</td>
                    <td className="px-4 py-4 align-top">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-4 py-4 align-top text-sm">
                      {item.email_verified ? "✓" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="min-w-0 space-y-4">
            {selected ? (
              <>
                <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
                  <h2 className="text-xl font-semibold">{selected.display_name}</h2>
                  <p className="mt-1 text-sm text-slate-500">{selected.domain}</p>
                  {selected.description && (
                    <p className="mt-2 text-sm text-slate-500">{selected.description}</p>
                  )}
                  {selected.tags && selected.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selected.tags.map((tag) => (
                        <span key={tag} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-mono text-slate-600">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 grid gap-2 text-sm text-slate-700">
                    <div>
                      <span className="font-medium">Catalog URL:</span>{" "}
                      {selected.registry_url ? (
                        <a
                          href={selected.registry_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all font-mono text-xs text-indigo-600 hover:underline"
                        >
                          {selected.registry_url}
                        </a>
                      ) : (
                        <span className="text-slate-400 italic">—</span>
                      )}
                    </div>
                    <div>
                      <span className="font-medium">TTL:</span> {selected.ttl_seconds}s
                    </div>
                    <div>
                      <span className="font-medium">Email verified:</span>{" "}
                      {selected.email_verified ? "Yes" : "No"}
                    </div>
                    <div>
                      <span className="font-medium">Created:</span>{" "}
                      {new Date(selected.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <JsonPanel data={selected} />
              </>
            ) : null}
          </div>
        </div>
      )}
    </PageShell>
  );
}
