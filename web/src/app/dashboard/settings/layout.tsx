import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: { absolute: "Account settings - NANDA Index" },
  description: "Manage your NANDA Index profile, password, sessions, and account deletion.",
};

export default function AccountSettingsLayout({ children }: { children: ReactNode }) {
  return children;
}
