import type { Metadata } from "next";

// The page is a client component, so its title lives in this server layout.
export const metadata: Metadata = {
  title: "Register an entry",
  description: "Add your agent or organization to the NANDA Index.",
};

export default function DashboardOrgsNewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
