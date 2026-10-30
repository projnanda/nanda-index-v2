import type { Metadata } from "next";

// The page is a client component, so its title lives in this server layout.
export const metadata: Metadata = {
  title: "Discover",
  description: "Look up an organization by org ID, keyword, URN, or a natural-language prompt.",
};

export default function QueryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
