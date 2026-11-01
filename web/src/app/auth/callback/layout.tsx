import type { Metadata } from "next";

// The page is a client component, so its title lives in this server layout.
export const metadata: Metadata = {
  title: "Signing you in",
  description: "Completing sign-in.",
};

export default function AuthCallbackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
