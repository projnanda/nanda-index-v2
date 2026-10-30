import type { Metadata } from "next";

// The page is a client component, so its title lives in this server layout.
export const metadata: Metadata = {
  title: "Set a new password",
  description: "Choose a new password for your account.",
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
