import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { externalLinks } from "@/lib/site-data";

export const metadata: Metadata = {
  title: "License",
  description: "The Apache License 2.0 terms for NandaIndex source code and documentation.",
};

export default function LicensePage() {
  const license = readFileSync(join(process.cwd(), "public", "LICENSE.txt"), "utf8");

  return (
    <PageShell title="License" description="NandaIndex source code and documentation are licensed under the Apache License, Version 2.0.">
      <div className="max-w-3xl space-y-6 text-sm leading-relaxed text-ink-medium">
        <p>
          You can use, copy, modify, and distribute the source code and documentation,
          including in commercial products, under the terms below. The same license is
          included in the{" "}
          <a href={`${externalLinks.github}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">
            NandaIndex repository
          </a>.
        </p>
        <p>
          The license does not grant permission to use the NandaIndex name or logo,
          or the names and logos of design partners. Linked papers, attributed quotes,
          and other third-party materials retain their own terms. The personal-agent
          demo in the repository&apos;s demo directory has a separate MIT license.
        </p>
        <p>
          <a href="/LICENSE.txt" className="text-brand-600 underline">Read the license as plain text</a>
        </p>
        <pre className="whitespace-pre-line break-words rounded-card border border-line bg-surface-light p-4 font-sans text-sm leading-relaxed sm:p-6">{license}</pre>
      </div>
    </PageShell>
  );
}
