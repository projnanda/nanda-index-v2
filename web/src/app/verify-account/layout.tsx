import type { Metadata } from "next";

// The page is a client component, so its title lives in this server layout.
export const metadata: Metadata = {
  title: "Verify your email",
  description: "Confirm your email address to start registering agents.",
};

export default function VerifyAccountLayout({ children }: { children: React.ReactNode }) {
  return children;
}
