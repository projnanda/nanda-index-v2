import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@/components/Analytics";
import { ConsentBanner } from "@/components/ConsentBanner";
import { PostHogAnalytics } from "@/components/PostHogAnalytics";
import { DEFAULT_POSTHOG_HOST, posthogHosts } from "@/lib/posthogHosts";
import { SITE_DESCRIPTION, SITE_TITLE, TITLE_TEMPLATE } from "@/lib/site-metadata";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

// Both optional and baked in at build time; each analytics tool is off unless set.
const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST;

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans-inter",
  display: "swap",
});

export const metadata: Metadata = {
  // Pages set their own title; the template adds the site name. The default
  // is the homepage's title and is used only where no page title exists.
  title: {
    default: SITE_TITLE,
    template: TITLE_TEMPLATE,
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://nandaindex.org"),
  // No explicit Open Graph title or description: each page's own values are
  // used, so shared links show the page rather than the site.
  openGraph: {
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
      <body className="bg-surface min-h-screen text-ink antialiased">
        <div id="top" className="min-h-screen flex flex-col">
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
        {(gaId || posthogKey) && <ConsentBanner googleAnalytics={!!gaId} posthog={!!posthogKey} />}
        {gaId && <Analytics gaId={gaId} />}
        {posthogKey && <PostHogAnalytics apiKey={posthogKey} uiHost={posthogHosts(posthogHost).ui} />}
      </body>
    </html>
  );
}
