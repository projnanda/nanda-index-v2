import { redirect } from "next/navigation";

// Account creation shares the sign-in page and opens in registration mode.
export default function RegisterRedirectPage() {
  redirect("/login?mode=register");
}
