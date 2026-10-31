// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountSettingsPage from './page';
import { Header } from '@/components/Header';
import { isPrivatePath } from '@/lib/analyticsPrivacy';

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard/settings',
}));
const token = (name: string) =>
  `header.${btoa(JSON.stringify({ userId: 'account-user', email: 'account@example.com', displayName: name, exp: 1900000000 }))}.signature`;
const initial = {
  user_id: 'account-user',
  email: 'account@example.com',
  email_verified: true,
  display_name: 'Original name',
  avatar_url: null,
  orgs: [],
  has_password: true,
  auth_provider: 'email',
  deletion_blockers: [] as { org_id: string; display_name: string }[],
};
let profile = { ...initial };
let failPath: string | null;
let calls: { path: string; init?: RequestInit }[];

beforeEach(() => {
  profile = { ...initial };
  failPath = null;
  calls = [];
  localStorage.clear();
  localStorage.setItem('nanda_auth_token', token('Original name'));
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      calls.push({ path, init });
      if (path === failPath) {
        return new Response(
          JSON.stringify(
            init?.method === 'DELETE'
              ? {
                  error: 'SOLE_ADMIN',
                  detail: 'Delete your sole-admin entries first.',
                  organizations: [{ org_id: 'new-entry', display_name: 'New entry' }],
                }
              : { error: 'INVALID_PASSWORD', detail: 'The current password is incorrect.' },
          ),
          { status: init?.method === 'DELETE' ? 409 : 403 },
        );
      }
      if (path === '/api/v1/me' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({ token: token(body.display_name), display_name: body.display_name }),
        );
      }
      if (path === '/api/v1/me' && init?.method === 'DELETE')
        return new Response(null, { status: 204 });
      if (path === '/api/v1/me') return new Response(JSON.stringify(profile));
      return new Response(JSON.stringify({ ok: true }));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function loaded() {
  render(<AccountSettingsPage />);
  return screen.findByLabelText('Display name');
}

describe('Account settings', () => {
  it('loads the profile and keeps account settings private from analytics', async () => {
    const name = await loaded();
    expect((name as HTMLInputElement).value).toBe('Original name');
    expect(screen.getByRole('heading', { name: 'Account settings' })).toBeTruthy();
    expect(isPrivatePath('/dashboard/settings')).toBe(true);
  });

  it('saves the display name and updates the header without navigating away', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Header />
        <AccountSettingsPage />
      </>,
    );
    const name = await screen.findByLabelText('Display name');
    await user.clear(name);
    await user.type(name, 'Updated name');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('Profile saved.');
    expect(screen.getByText('Updated name')).toBeTruthy();
    expect(localStorage.getItem('nanda_auth_token')).toBe(token('Updated name'));
    const save = calls.find((call) => call.init?.method === 'PATCH')!;
    expect(JSON.parse(String(save.init?.body))).toEqual({ display_name: 'Updated name' });
  });

  it('checks the password confirmation before changing it and clears the session after success', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.type(screen.getByLabelText('Current password'), 'existing-password');
    await user.type(screen.getByLabelText('New password'), 'changed-password');
    await user.type(screen.getByLabelText('Confirm new password'), 'different-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect((await screen.findByRole('alert')).textContent).toContain('do not match');
    expect(calls.some((call) => call.path === '/auth/change-password')).toBe(false);
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), 'changed-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await screen.findByText('Your password changed. All sessions have been signed out.');
    expect(localStorage.getItem('nanda_auth_token')).toBeNull();
    expect(calls.find((call) => call.path === '/auth/change-password')?.init?.body).toBe(
      JSON.stringify({ current_password: 'existing-password', new_password: 'changed-password' }),
    );
  });

  it('rejects a new password over 72 UTF-8 bytes before sending it', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.type(screen.getByLabelText('Current password'), 'existing-password');
    await user.type(screen.getByLabelText('New password'), 'é'.repeat(37));
    await user.type(screen.getByLabelText('Confirm new password'), 'é'.repeat(37));
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect((await screen.findByRole('alert')).textContent).toContain('72');
    expect(calls.some((call) => call.path === '/auth/change-password')).toBe(false);
    expect(localStorage.getItem('nanda_auth_token')).not.toBeNull();
  });

  it('shows a rejected current password without signing the user out', async () => {
    failPath = '/auth/change-password';
    const user = userEvent.setup();
    await loaded();
    await user.type(screen.getByLabelText('Current password'), 'wrong-password');
    await user.type(screen.getByLabelText('New password'), 'changed-password');
    await user.type(screen.getByLabelText('Confirm new password'), 'changed-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'current password is incorrect',
    );
    expect(localStorage.getItem('nanda_auth_token')).not.toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Change password' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('calls logout-all before clearing the current session', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    await screen.findByText('All sessions have been signed out.');
    expect(calls.find((call) => call.path === '/auth/logout-all')?.init?.headers).toMatchObject({
      Authorization: expect.stringContaining('Bearer '),
    });
    expect(localStorage.getItem('nanda_auth_token')).toBeNull();
  });

  it('requires typed deletion confirmation before sending the destructive request', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.type(screen.getByLabelText('Password to delete account'), 'existing-password');
    await user.click(screen.getByRole('button', { name: 'Delete account permanently' }));
    expect(calls.some((call) => call.init?.method === 'DELETE')).toBe(false);
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(screen.getByRole('button', { name: 'Delete account permanently' }));
    await screen.findByText(
      'Your account has been deleted. Shared index entries remain published.',
    );
    expect(localStorage.getItem('nanda_auth_token')).toBeNull();
    expect(
      JSON.parse(String(calls.find((call) => call.init?.method === 'DELETE')?.init?.body)),
    ).toEqual({ confirmation: 'DELETE', current_password: 'existing-password' });
  });

  it('lists sole-admin entries and explains that shared records remain published', async () => {
    profile.deletion_blockers = [{ org_id: 'sole-entry', display_name: 'My only entry' }];
    await loaded();
    expect(screen.getByRole('link', { name: 'My only entry' }).getAttribute('href')).toBe(
      '/dashboard/orgs/sole-entry',
    );
    expect(screen.getByText(/Shared entries remain published/)).toBeTruthy();
  });

  it('shows newly detected ownership blockers without losing the account', async () => {
    const user = userEvent.setup();
    await loaded();
    failPath = '/api/v1/me';
    await user.type(screen.getByLabelText('Password to delete account'), 'existing-password');
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(screen.getByRole('button', { name: 'Delete account permanently' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('link', { name: 'New entry' }).getAttribute('href')).toBe(
      '/dashboard/orgs/new-entry',
    );
    expect(localStorage.getItem('nanda_auth_token')).not.toBeNull();
  });

  it('lets an OAuth user request and submit a deletion code without a password', async () => {
    profile.has_password = false;
    profile.auth_provider = 'google';
    const user = userEvent.setup();
    await loaded();
    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(screen.getByText(/Google/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Email deletion code' }));
    await screen.findByText(/Check your email for a deletion code/);
    await user.type(screen.getByLabelText('Deletion code'), 'test-email-code');
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(screen.getByRole('button', { name: 'Delete account permanently' }));
    await waitFor(() => expect(localStorage.getItem('nanda_auth_token')).toBeNull());
    expect(
      JSON.parse(String(calls.find((call) => call.init?.method === 'DELETE')?.init?.body)),
    ).toEqual({ confirmation: 'DELETE', deletion_code: 'test-email-code' });
    expect(
      calls.find((call) => call.path === '/auth/request-account-deletion')?.init?.body,
    ).toBeUndefined();
  });

  it('does not replace a newer session when a profile save finishes late', async () => {
    const user = userEvent.setup();
    await loaded();
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    const newer = token('Another signed-in account');
    localStorage.setItem('nanda_auth_token', newer);
    await act(async () =>
      finish(
        new Response(
          JSON.stringify({ token: token('Old response'), display_name: 'Old response' }),
        ),
      ),
    );
    expect(localStorage.getItem('nanda_auth_token')).toBe(newer);
    expect(router.replace).toHaveBeenCalledWith('/dashboard');
  });

  it('does not clear a newer session when an old profile load returns 401', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    render(<AccountSettingsPage />);
    const newer = token('Another signed-in account');
    localStorage.setItem('nanda_auth_token', newer);
    await act(async () =>
      finish(new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 })),
    );
    expect(localStorage.getItem('nanda_auth_token')).toBe(newer);
    expect(router.replace).toHaveBeenCalledWith('/dashboard');
  });

  it('explains email verification before an OAuth deletion code can be requested', async () => {
    profile.has_password = false;
    profile.auth_provider = 'github';
    profile.email_verified = false;
    await loaded();
    expect(
      (screen.getByRole('button', { name: 'Email deletion code' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByText(/Verify your account email before requesting a deletion code/),
    ).toBeTruthy();
  });
});
