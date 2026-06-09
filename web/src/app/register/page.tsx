import { redirect } from "next/navigation";

// Registration now requires OAuth — redirect to login which leads to dashboard/orgs/new
export default function RegisterRedirectPage() {
  redirect("/login");
}
