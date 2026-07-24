import type { Metadata } from "next";
import { Cormorant_Garamond, IBM_Plex_Mono, Jost } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

// Brand type system v2.0 (guidelines p.03).
// Display / headlines / logo — "what NANDA believes".
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-display-serif",
  display: "swap",
});

// Body / paragraph / interface — "what NANDA does".
// The brand font for this role is Garet, a commercial face that cannot be
// fetched from Google Fonts. Jost is a geometric sans with closely matching
// proportions and serves as the fallback; `--font-sans` in globals.css lists
// "Garet" ahead of it, so supplying the licensed font file takes over here
// with no code change.
const garetFallback = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans-body",
  display: "swap",
});

// Labels / page numbers / tags / code — "what NANDA measures".
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NANDA Index - Federated Agent Discovery",
  description:
    "A DNS-inspired trust framework for cross-organization AI agent discovery.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://nandaindex.org"),
  openGraph: {
    title: "NANDA Index - Federated Agent Discovery",
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
    <html
      lang="en"
      className={`${cormorant.variable} ${garetFallback.variable} ${plexMono.variable}`}
    >
      <body className="bg-surface min-h-screen text-ink antialiased">
        <div id="top" className="min-h-screen flex flex-col">
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
