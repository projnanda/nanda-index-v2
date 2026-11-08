import type { Metadata } from "next";
import { TITLE_TEMPLATE } from "@/lib/site-metadata";

// The page is a client component, so its title lives in this server layout.
// Setting a title here replaces the root template for the routes below
// (/dashboard/orgs/...), so the template is passed on explicitly.
export const metadata: Metadata = {
  title: { default: "Dashboard", template: TITLE_TEMPLATE },
  description: "Manage the organizations you have registered in the NANDA Index.",
};

// Recording stops on arrival here (PostHogAnalytics), but the first render can
// land in the replay before that; ph-no-capture keeps the recorder out of it.
// `contents` leaves the page layout as if this wrapper were not there.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className="ph-no-capture contents">{children}</div>;
}
