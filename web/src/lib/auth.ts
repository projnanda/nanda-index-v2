const TOKEN_KEY = "nanda_auth_token";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY);
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
    const payload = JSON.parse(atob(parts[1]!)) as unknown;
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
