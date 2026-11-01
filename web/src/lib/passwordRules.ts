export const NEW_PASSWORD_GUIDANCE =
  "Use at least 8 characters and no more than 72 bytes. Accented letters and emoji can use more than one byte.";

// Match the server's new-password policy. Existing passwords remain valid for
// sign-in and as proof of account control, including older, longer credentials.
export function newPasswordError(password: string): string | null {
  if (Array.from(password).length < 8) return "Use at least 8 characters for the new password.";
  if (new TextEncoder().encode(password).length > 72) {
    return "Use no more than 72 bytes for the new password. Accented letters and emoji can use more than one byte.";
  }
  return null;
}
