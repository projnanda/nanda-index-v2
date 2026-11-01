import Link from "next/link";
import { CookieSettingsButton } from "@/components/CookieSettingsButton";
import { apiDocsUrl } from "@/lib/api-docs";

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface-light">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-ink-weak sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <p>NANDA Index - a global switchboard for the agentic web</p>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href="/developers" className="underline hover:text-brand-600">Developers</Link>
          <a href={apiDocsUrl()} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand-600">
            API reference
          </a>
          <Link href="/privacy" className="underline hover:text-brand-600">Privacy</Link>
          <CookieSettingsButton />
        </p>
      </div>
    </footer>
  );
}
