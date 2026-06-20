import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NANDA Index — Federated Agent Discovery",
  description:
    "A DNS-inspired trust framework for cross-organization AI agent discovery.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://nandaindex.org"),
  openGraph: {
    title: "NANDA Index — Federated Agent Discovery",
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
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-[color:var(--color-bg)] text-[color:var(--color-fg-default)] antialiased">
        <div id="top" className="min-h-screen flex flex-col">
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
