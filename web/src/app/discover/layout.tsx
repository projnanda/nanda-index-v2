import type { Metadata } from "next";

// The page is a client component, so its title lives in this server layout.
export const metadata: Metadata = {
  title: "Discover",
  description: "Look up an entry by org ID, keyword, or URN. Explore browses every entry; Resolve traces one URN hop by hop.",
};

export default function QueryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
