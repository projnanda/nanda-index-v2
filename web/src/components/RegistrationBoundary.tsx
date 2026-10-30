"use client";

import { Component, type ReactNode } from "react";
import Link from "next/link";
import { PageShell } from "./PageShell";

/** A successful write must keep an onward route even if its confirmation cannot render. */
export class RegistrationBoundary extends Component<{
  children: ReactNode;
  savedOrgId?: string;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const saved = this.props.savedOrgId;
    return (
      <PageShell title={saved ? "Registration saved" : "Registration unavailable"} description="">
        <div role="alert" className="mx-auto max-w-lg space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          <p>{saved
            ? "Your registration was saved, but the confirmation could not be displayed. Open your entry to check its status and finish verification."
            : "The registration form could not be displayed. Check your dashboard before trying again."}</p>
          <div className="flex flex-wrap gap-4">
            {saved && <Link className="font-medium underline" href={`/dashboard/orgs/${encodeURIComponent(saved)}`}>Open your entry</Link>}
            <Link className="font-medium underline" href="/dashboard">Go to dashboard</Link>
            {!saved && <button type="button" className="font-medium underline" onClick={() => this.setState({ failed: false })}>Try again</button>}
          </div>
        </div>
      </PageShell>
    );
  }
}
