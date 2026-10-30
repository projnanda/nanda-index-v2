"use client";

import { useEffect, useState } from "react";
import { getAuthProviders } from "@/lib/nanda-api";

type Providers = { google: boolean; github: boolean };

/**
 * The sign-in options this deployment actually offers, as a sentence
 * fragment for the privacy page: ", or a Google sign-in" and so on. It asks
 * the API which OAuth providers are configured (the same call the login page
 * makes) and renders nothing until it knows, and nothing when none are on,
 * so the page never claims a provider the deployment does not have.
 */
export function SignInMethods() {
  const [providers, setProviders] = useState<Providers | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAuthProviders()
      .then((p) => {
        if (!cancelled) setProviders(p);
      })
      .catch(() => {
        if (!cancelled) setProviders({ google: false, github: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const names = [providers?.google && "Google", providers?.github && "GitHub"].filter(Boolean);
  if (names.length === 0) return null;
  return <>, or a {names.join(" or ")} sign-in</>;
}
