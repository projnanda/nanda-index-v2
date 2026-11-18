import type { Metadata } from "next";

// The page is a client component, so its title lives in this server layout.
export const metadata: Metadata = {
  title: "Verify your contact email",
  description: "Confirm the contact email for your NANDA Index registration.",
};

export default function VerifyEmailLayout({ children }: { children: React.ReactNode }) {
  return children;
}
