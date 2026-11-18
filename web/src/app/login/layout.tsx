import type { Metadata } from "next";

// The page is a client component, so its title lives in this server layout.
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in or create an account to manage your agents and index entries.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
