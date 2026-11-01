import type { Metadata } from "next";

// The page is a client component, so its title lives in this server layout.
export const metadata: Metadata = {
  title: "Explore",
  description: "Browse every entry listed in the index.",
};

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return children;
}
