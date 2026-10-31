import type { Metadata } from "next";

// The page is a client component, so its title lives in this server layout.
export const metadata: Metadata = {
  title: "Resolve",
  description: "Resolve a resource identifier to the appropriate discovery entry point.",
};

export default function ResolveLayout({ children }: { children: React.ReactNode }) {
  return children;
}
