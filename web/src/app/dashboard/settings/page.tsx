"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { clearAuthToken, getAuthToken, setAuthToken, subscribeAuthChanges } from "@/lib/auth";
import { NEW_PASSWORD_GUIDANCE, newPasswordError } from "@/lib/passwordRules";
import {
  ApiError,
  changePassword,
  deleteAccount,
  getAccountSettings,
  logoutAll,
  requestAccountDeletion,
  updateProfile,
  type AccountSettings,
} from "@/lib/nanda-api";

const card = "space-y-4 rounded-card border border-line bg-surface-light p-5 sm:p-6 shadow-card";
const input =
  "mt-1 block w-full rounded-control border-2 border-line bg-surface-light px-3 py-2 text-sm text-ink focus:outline-none focus:border-brand-500";
const button =
  "inline-flex min-h-10 items-center justify-center rounded-control bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60";
const label = "block text-sm font-medium text-ink";
type Action = "profile" | "password" | "logout" | "code" | "delete";
type Message = { kind: "error" | "success"; text: string };
class SessionChangedError extends Error {}

function errorDetail(error: unknown): string {
  if (error instanceof ApiError && error.payload && typeof error.payload === "object") {
    const detail = (error.payload as Record<string, unknown>).detail;
    if (typeof detail === "string") return detail;
  }
  return "The request could not be completed. Please try again.";
}

function deletionBlockers(error: ApiError): AccountSettings["deletion_blockers"] | null {
  if (error.code !== "SOLE_ADMIN" || !error.payload || typeof error.payload !== "object")
    return null;
  const organizations = (error.payload as Record<string, unknown>).organizations;
  if (!Array.isArray(organizations)) return null;
  return organizations.filter(
    (entry): entry is AccountSettings["deletion_blockers"][number] =>
      entry &&
      typeof entry === "object" &&
      typeof entry.org_id === "string" &&
      typeof entry.display_name === "string",
  );
}

export default function AccountSettingsPage() {
  useRequireAuth();
  const router = useRouter();
  const [account, setAccount] = useState<AccountSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteCode, setDeleteCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const loadedSession = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const requestToken = getAuthToken();
    getAccountSettings()
      .then((profile) => {
        if (cancelled) return;
        if (getAuthToken() !== requestToken) {
          router.replace(getAuthToken() ? "/dashboard" : "/login");
          return;
        }
        loadedSession.current = requestToken;
        setAccount(profile);
        setDisplayName(profile.display_name ?? "");
        setMessage(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (getAuthToken() !== requestToken) {
          router.replace(getAuthToken() ? "/dashboard" : "/login");
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          clearAuthToken();
          router.replace("/login?reason=session_expired");
        } else
          setMessage({ kind: "error", text: "Could not load your account. Please try again." });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retry, router]);

  useEffect(
    () =>
      subscribeAuthChanges(() => {
        if (loadedSession.current && getAuthToken() !== loadedSession.current) {
          setAccount(null);
          router.replace(getAuthToken() ? "/dashboard" : "/login");
        }
      }),
    [router],
  );

  useEffect(() => {
    if (message?.kind === "error") messageRef.current?.focus();
  }, [message]);

  function signedOut(text: string) {
    loadedSession.current = null;
    clearAuthToken();
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setDeletePassword("");
    setDeleteCode("");
    setOutcome(text);
  }

  async function run(action: Action, work: (assertCurrentSession: () => void) => Promise<void>) {
    if (busy) return;
    const requestToken = getAuthToken();
    if (!requestToken || requestToken !== loadedSession.current) {
      setAccount(null);
      router.replace(requestToken ? "/dashboard" : "/login");
      return;
    }
    setBusy(action);
    setMessage(null);
    try {
      await work(() => {
        if (getAuthToken() !== requestToken) throw new SessionChangedError();
      });
    } catch (error) {
      if (error instanceof SessionChangedError || getAuthToken() !== requestToken) {
        setAccount(null);
        router.replace(getAuthToken() ? "/dashboard" : "/login");
      } else if (error instanceof ApiError && error.status === 401) {
        clearAuthToken();
        router.replace("/login?reason=session_expired");
      } else {
        if (error instanceof ApiError) {
          const blockers = deletionBlockers(error);
          if (blockers)
            setAccount((current) => current && { ...current, deletion_blockers: blockers });
        }
        setMessage({ kind: "error", text: errorDetail(error) });
      }
    } finally {
      setBusy(null);
    }
  }

  if (outcome)
    return (
      <PageShell title="Account settings" description={outcome}>
        <Link href="/login" className="text-brand-600 underline">
          Sign in
        </Link>
      </PageShell>
    );

  return (
    <PageShell
      title="Account settings"
      description="Manage your profile, password, and account access."
    >
      <div className="max-w-2xl space-y-6" aria-busy={loading || !!busy}>
        <Link href="/dashboard" className="text-sm text-brand-600 underline">
          Back to dashboard
        </Link>
        {message && (
          <p
            ref={messageRef}
            tabIndex={-1}
            role={message.kind === "error" ? "alert" : "status"}
            className={`rounded-control border p-3 text-sm ${message.kind === "error" ? "border-red-300 text-red-800" : "border-green-300 text-green-800"}`}
          >
            {message.text}
          </p>
        )}
        {loading && <p role="status">Loading your account…</p>}
        {!loading && !account && (
          <button
            type="button"
            className={button}
            onClick={() => {
              setLoading(true);
              setRetry((value) => value + 1);
            }}
          >
            Try again
          </button>
        )}
        {account && (
          <>
            <section className={card} aria-labelledby="profile-heading">
              <h2 id="profile-heading" className="text-lg font-semibold text-ink-strong">
                Profile
              </h2>
              <p className="break-all text-sm text-ink-medium">Signed in as {account.email}</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run("profile", async (assertCurrentSession) => {
                    const saved = await updateProfile(displayName);
                    assertCurrentSession();
                    loadedSession.current = saved.token;
                    setAuthToken(saved.token);
                    setDisplayName(saved.display_name ?? "");
                    setAccount(
                      (current) => current && { ...current, display_name: saved.display_name },
                    );
                    setMessage({ kind: "success", text: "Profile saved." });
                  });
                }}
              >
                <fieldset disabled={!!busy} className="space-y-4">
                  <label htmlFor="account-name" className={label}>
                    Display name
                    <input
                      id="account-name"
                      autoComplete="nickname"
                      maxLength={255}
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      className={input}
                    />
                  </label>
                  <button className={button} type="submit">
                    {busy === "profile" ? "Saving…" : "Save profile"}
                  </button>
                </fieldset>
              </form>
            </section>

            <section className={card} aria-labelledby="password-heading">
              <h2 id="password-heading" className="text-lg font-semibold text-ink-strong">
                Password
              </h2>
              {account.has_password ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const passwordError = newPasswordError(newPassword);
                    if (passwordError) {
                      setMessage({ kind: "error", text: passwordError });
                      return;
                    }
                    if (newPassword !== confirmPassword) {
                      setMessage({ kind: "error", text: "The new passwords do not match." });
                      return;
                    }
                    void run("password", async (assertCurrentSession) => {
                      await changePassword(currentPassword, newPassword);
                      assertCurrentSession();
                      signedOut("Your password changed. All sessions have been signed out.");
                    });
                  }}
                >
                  <fieldset disabled={!!busy} className="space-y-4">
                    <p id="password-help" className="text-sm text-ink-medium">
                      {NEW_PASSWORD_GUIDANCE} Changing your password signs out every device,
                      including this one.
                    </p>
                    <label htmlFor="current-password" className={label}>
                      Current password
                      <input
                        id="current-password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={currentPassword}
                        onChange={(event) => setCurrentPassword(event.target.value)}
                        className={input}
                      />
                    </label>
                    <label htmlFor="new-password" className={label}>
                      New password
                      <input
                        id="new-password"
                        type="password"
                        autoComplete="new-password"
                        aria-describedby="password-help"
                        required
                        minLength={8}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        className={input}
                      />
                    </label>
                    <label htmlFor="confirm-password" className={label}>
                      Confirm new password
                      <input
                        id="confirm-password"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        className={input}
                      />
                    </label>
                    <button type="submit" className={button}>
                      {busy === "password" ? "Changing…" : "Change password"}
                    </button>
                  </fieldset>
                </form>
              ) : (
                <p className="text-sm text-ink-medium">
                  You sign in with {account.auth_provider === "google" ? "Google" : "GitHub"}.
                  Manage your password with that provider.
                </p>
              )}
            </section>

            <section className={card} aria-labelledby="sessions-heading">
              <h2 id="sessions-heading" className="text-lg font-semibold text-ink-strong">
                Sessions
              </h2>
              <p className="text-sm text-ink-medium">
                Sign out every device, including this one. You can sign in again with your current
                password or provider.
              </p>
              <button
                type="button"
                disabled={!!busy}
                className={button}
                onClick={() =>
                  void run("logout", async (assertCurrentSession) => {
                    await logoutAll();
                    assertCurrentSession();
                    signedOut("All sessions have been signed out.");
                  })
                }
              >
                {busy === "logout" ? "Signing out…" : "Sign out everywhere"}
              </button>
            </section>

            <section className={`${card} border-red-200`} aria-labelledby="delete-heading">
              <h2 id="delete-heading" className="text-lg font-semibold text-ink-strong">
                Delete account
              </h2>
              <p id="delete-help" className="text-sm text-ink-medium">
                Deletion permanently removes your profile, sign-in email, memberships, and account
                tokens. Shared entries remain published with their existing public and contact data,
                including any email addresses in those records.
              </p>
              {account.deletion_blockers.length > 0 ? (
                <div className="space-y-3 text-sm text-ink-medium">
                  <p>
                    Your account is the only administrator of these entries. Delete each entry from
                    its settings, then return here.
                  </p>
                  <ul className="list-disc space-y-2 pl-5">
                    {account.deletion_blockers.map((entry) => (
                      <li key={entry.org_id}>
                        <Link
                          className="text-brand-600 underline"
                          href={`/dashboard/orgs/${encodeURIComponent(entry.org_id)}`}
                        >
                          {entry.display_name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  {!account.has_password && (
                    <div className="space-y-3">
                      <p className="text-sm text-ink-medium">
                        Confirm account control with a code sent to your verified account email. The
                        code expires in 15 minutes.
                      </p>
                      {!account.email_verified && (
                        <p className="text-sm text-ink-medium">
                          Verify your account email before requesting a deletion code.{" "}
                          <Link href="/dashboard" className="text-brand-600 underline">
                            Open your dashboard to verify it.
                          </Link>{" "}
                          If this address cannot receive mail, add a verified email to your sign-in
                          provider and sign in again.
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={!!busy || !account.email_verified}
                        className={button}
                        onClick={() =>
                          void run("code", async (assertCurrentSession) => {
                            await requestAccountDeletion();
                            assertCurrentSession();
                            setMessage({
                              kind: "success",
                              text: "Check your email for a deletion code. Wait one minute before requesting another.",
                            });
                          })
                        }
                      >
                        {busy === "code" ? "Sending…" : "Email deletion code"}
                      </button>
                    </div>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (confirmation !== "DELETE") {
                        setMessage({
                          kind: "error",
                          text: "Type DELETE to confirm account deletion.",
                        });
                        return;
                      }
                      void run("delete", async (assertCurrentSession) => {
                        await deleteAccount(
                          account.has_password
                            ? { current_password: deletePassword }
                            : { deletion_code: deleteCode.trim() },
                        );
                        assertCurrentSession();
                        signedOut(
                          "Your account has been deleted. Shared index entries remain published.",
                        );
                      });
                    }}
                  >
                    <fieldset disabled={!!busy} className="space-y-4">
                      {account.has_password ? (
                        <label htmlFor="delete-password" className={label}>
                          Password to delete account
                          <input
                            id="delete-password"
                            type="password"
                            autoComplete="current-password"
                            required
                            value={deletePassword}
                            onChange={(event) => setDeletePassword(event.target.value)}
                            className={input}
                          />
                        </label>
                      ) : (
                        <label htmlFor="delete-code" className={label}>
                          Deletion code
                          <input
                            id="delete-code"
                            autoComplete="one-time-code"
                            required
                            maxLength={128}
                            value={deleteCode}
                            onChange={(event) => setDeleteCode(event.target.value)}
                            className={input}
                          />
                        </label>
                      )}
                      <label htmlFor="delete-confirmation" className={label}>
                        Type DELETE to confirm
                        <input
                          id="delete-confirmation"
                          required
                          pattern="DELETE"
                          autoComplete="off"
                          aria-describedby="delete-help"
                          value={confirmation}
                          onChange={(event) => setConfirmation(event.target.value)}
                          className={input}
                        />
                      </label>
                      <button type="submit" className={`${button} bg-red-700 hover:bg-red-800`}>
                        {busy === "delete" ? "Deleting…" : "Delete account permanently"}
                      </button>
                    </fieldset>
                  </form>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </PageShell>
  );
}
