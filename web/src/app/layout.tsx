import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "NANDA Index — Global Agent Registry",
  description:
    "A DNS-inspired trust framework for cross-organization AI agent discovery.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://nandaindex.org"),
  openGraph: {
    title: "NANDA Index — Global Agent Registry",
    description:
      "A DNS-inspired trust framework for cross-organization AI agent discovery.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[color:var(--page-bg)] text-slate-900 antialiased">
        <div id="top" className="min-h-screen flex flex-col">
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}