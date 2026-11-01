import type { Metadata } from "next";

// The page is a client component, so its title lives in this server layout.
// The org_id from the URL names the tab; the display name is only known
// after the page loads the record.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ org_id: string }>;
}): Promise<Metadata> {
  const { org_id } = await params;
  return { title: `Manage ${org_id}` };
}

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  return children;
}
