"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export type OrgAction = "suspend" | "reactivate" | "delete";
const LABELS: Record<OrgAction, string> = { suspend: "Suspend", reactivate: "Reactivate", delete: "Delete" };

export function OrgActionDialog({ action, orgId, domain, busy, error, onConfirm, onCancel }: {
  action: OrgAction; orgId: string; domain: string | null; busy: boolean; error: string | null;
  onConfirm: () => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const id = useId();
  const [confirmation, setConfirmation] = useState("");
  const canConfirm = !busy && (action !== "delete" || confirmation === orgId);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const node = dialog.current!;
    mounted.current = true;
    node.showModal();
    cancel.current?.focus();
    return () => {
      mounted.current = false;
      node.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  useLayoutEffect(() => {
    // Native close may precede the busy render, or its queued close event may
    // arrive after a failure. Reopen before a queued event can hide that error.
    if ((busy || error) && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [busy, error]);

  return (
    <dialog ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}
      onClose={(event) => {
        const node = event.currentTarget;
        // Ignore cleanup and queued close events from an earlier modal opening.
        if (!mounted.current || node.open) return;
        if (busy) node.showModal();
        else onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-3xl border border-black/10 bg-white p-6 shadow-xl backdrop:bg-black/40">
      <form onSubmit={(event) => { event.preventDefault(); if (canConfirm) onConfirm(); }} className="space-y-4">
        <h2 id={`${id}-title`} className="text-lg font-semibold text-slate-950">{LABELS[action]} entry</h2>
        <p id={`${id}-description`} className="text-sm text-slate-700">
          {action === "delete"
            ? `Permanently delete "${orgId}" and its registration data. This cannot be undone. The handle${domain ? ` and domain ${domain}` : ""} can then be claimed by someone else.`
            : action === "suspend"
              ? `Suspend "${orgId}" to remove it from public index results and resolution. You can reactivate it later.`
              : `Make "${orgId}" active again. Existing ownership verification and operator restrictions still apply.`}
        </p>
        {action === "delete" && (
          <div className="space-y-2">
            <label htmlFor={`${id}-confirmation`} className="block text-sm font-medium">Type {orgId} to confirm</label>
            <input id={`${id}-confirmation`} value={confirmation} autoComplete="off" spellCheck={false} disabled={busy}
              onChange={(event) => setConfirmation(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-2 focus:outline-slate-500" />
          </div>
        )}
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button ref={cancel} type="button" onClick={onCancel} disabled={busy} className="rounded-xl border border-slate-300 px-4 py-2 text-sm disabled:opacity-60">Cancel</button>
          <button type="submit" disabled={!canConfirm} className="rounded-xl bg-slate-950 px-4 py-2 text-sm text-white disabled:opacity-60">
            {busy ? "Working…" : `${LABELS[action]} entry`}
          </button>
        </div>
      </form>
    </dialog>
  );
}
