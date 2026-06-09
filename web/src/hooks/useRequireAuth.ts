"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAuthToken, isTokenExpired, clearAuthToken } from "@/lib/auth";

/**
 * Redirects to /login if there is no valid, non-expired JWT in localStorage.
 * Call at the top of every protected page.
 */
export function useRequireAuth(): void {
  const router = useRouter();

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (isTokenExpired(token)) {
      clearAuthToken();
      router.replace("/login?reason=session_expired");
    }
  }, [router]);
}
