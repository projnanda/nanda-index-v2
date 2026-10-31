const TOKEN_KEY = "nanda_auth_token";
const AUTH_CHANGE_EVENT = "nanda:auth-change";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

/** Notify the header after profile updates, sign-in, or sign-out in any tab. */
export function subscribeAuthChanges(listener: () => void): () => void {
  window.addEventListener(AUTH_CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(AUTH_CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

interface JwtPayload {
  userId: string;
  email: string;
  displayName: string | null;
  exp?: number;
}

export function parseJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // JWT payloads are unpadded base64url-encoded UTF-8, while atob returns bytes.
    const encoded = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    if (typeof payload !== "object" || payload === null) return null;
    const p = payload as Record<string, unknown>;
    if (typeof p["userId"] !== "string" || typeof p["email"] !== "string") return null;
    return {
      userId:      p["userId"] as string,
      email:       p["email"] as string,
      displayName: typeof p["displayName"] === "string" ? p["displayName"] : null,
      exp:         typeof p["exp"] === "number" ? p["exp"] : undefined,
    };
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const payload = parseJwtPayload(token);
  if (!payload?.exp) return false;
  return Date.now() / 1000 > payload.exp;
}
