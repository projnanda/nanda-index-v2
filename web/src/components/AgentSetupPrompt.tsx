"use client";

import { useState } from "react";

const SETUP_PROMPT =
  "Follow the instructions at https://my.nandaindex.org to set up and register my agent using [your email address].";

export function AgentSetupPrompt() {
  const [copyStatus, setCopyStatus] = useState<"ready" | "copied" | "error">("ready");

  async function copyPrompt() {
    setCopyStatus("ready");
    try {
      await navigator.clipboard.writeText(SETUP_PROMPT);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  return (
    <section
      id="agent-setup"
      aria-labelledby="agent-setup-heading"
      className="mt-8 rounded-card border border-brand-300 bg-brand-200 p-5"
    >
      <h2 id="agent-setup-heading" className="text-lg font-bold text-ink-strong">
        Register your personal agent
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-medium">
        Paste this prompt into Muse, Claude Code, or another agent with web and API
        access. Replace [your email address] with an email you can access.
      </p>
      <div className="mt-4 rounded-control border border-line bg-white p-4">
        <p className="break-words font-mono text-sm leading-relaxed text-ink">
          {SETUP_PROMPT}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={copyPrompt}
            className="inline-flex h-9 items-center justify-center rounded-control bg-brand-800 px-4 text-sm font-medium text-white transition hover:bg-brand-700"
          >
            Copy prompt
          </button>
          <span role="status" className="text-sm text-ink-medium">
            {copyStatus === "copied" && "Prompt copied."}
            {copyStatus === "error" && "Select and copy the prompt above."}
          </span>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink-medium">
        The instructions at{" "}
        <a
          href="https://my.nandaindex.org/"
          className="text-brand-600 underline underline-offset-4 hover:text-brand-700"
        >
          my.nandaindex.org
        </a>{" "}
        guide your agent through creating an Inkbox address and registering it on
        NandaIndex. You will receive a verification code by email.
      </p>
    </section>
  );
}
