import type { Metadata } from "next";

// The page is a client component, so its title lives in this server layout.
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to manage your organization's index record.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
