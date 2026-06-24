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
        {(["active", "all", "pending", "suspended"] as const).map((s) => {
          const active = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={
                "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize border-2 transition-colors " +
                (active
                  ? "border-brand-500 bg-brand-200 text-brand-800"
                  : "border-line bg-surface-light text-ink hover:border-line-strong")
              }
            >
              {s}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="bg-surface-light rounded-card border border-line p-6 text-sm text-ink-medium shadow-card">
          Loading…
        </div>
      ) : error ? (
        <div className="mb-6 rounded-card border border-[#b42318]/30 bg-[#fef3f2] p-4 text-sm text-[#b42318]">
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
          <div className="overflow-hidden rounded-card border border-line bg-surface-light shadow-card">
            <table className="w-full table-fixed text-left">
              <colgroup>
                <col style={{ width: "35%" }} />
                <col style={{ width: "35%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "15%" }} />
              </colgroup>
              <thead className="bg-surface-strong text-xs font-bold uppercase tracking-wide text-ink-weak">
                <tr>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Domain</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Verified</th>
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
                      {item.domain_verified ? "✓" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="min-w-0 space-y-4">
            {selected ? (
              <>
                <div className="bg-surface-light rounded-card border border-line p-6 shadow-card">
                  <h2 className="font-semibold text-ink-strong text-xl">{selected.display_name}</h2>
                  <p className="mt-1 text-sm text-ink-medium">{selected.domain}</p>
                  {selected.description && (
                    <p className="mt-2 text-sm leading-relaxed text-ink-medium">{selected.description}</p>
                  )}
                  {selected.tags && selected.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {selected.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-surface-tag text-ink"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 grid gap-2 text-sm text-ink">
                    <div>
                      <span className="font-semibold text-ink-strong">Catalog URL:</span>{" "}
                      {selected.registry_url ? (
                        <a
                          href={selected.registry_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all font-mono text-xs text-brand-600 hover:underline"
                        >
                          {selected.registry_url}
                        </a>
                      ) : (
                        <span className="text-ink-weak">-</span>
                      )}
                    </div>
                    <div>
                      <span className="font-semibold text-ink-strong">TTL:</span> {selected.ttl_seconds}s
                    </div>
                    <div>
                      <span className="font-medium">Domain verified:</span>{" "}
                      {selected.domain_verified ? "Yes" : "No"}
                    </div>
                    <div>
                      <span className="font-semibold text-ink-strong">Created:</span>{" "}
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
