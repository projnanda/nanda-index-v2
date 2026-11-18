// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './login/page';
import ResetPasswordPage from './reset-password/page';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams('token=test-reset-token'),
}));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (input: string) =>
        new Response(
          JSON.stringify(
            String(input) === '/auth/providers'
              ? { google: false, github: false }
              : { token: 'new-session', ok: true },
          ),
        ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('new password validation in authentication forms', () => {
  it('blocks an oversized registration password before sending it', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await user.type(screen.getByPlaceholderText('Email'), 'new@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'é'.repeat(37));
    await user.click(screen.getAllByRole('button', { name: 'Create account' }).at(-1)!);
    expect((await screen.findByRole('alert')).textContent).toContain('72');
    expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path) === '/auth/register')).toBe(
      false,
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('allows an existing long password at sign-in', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByPlaceholderText('Email'), 'existing@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'é'.repeat(50));
    await user.click(screen.getAllByRole('button', { name: 'Sign in' }).at(-1)!);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/dashboard'));
    const login = vi.mocked(fetch).mock.calls.find(([path]) => String(path) === '/auth/login')!;
    expect(JSON.parse(String(login[1]?.body)).password).toBe('é'.repeat(50));
  });

  it('blocks an oversized reset password before sending it', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await user.type(screen.getByPlaceholderText('New password'), 'é'.repeat(37));
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'é'.repeat(37));
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect((await screen.findByRole('alert')).textContent).toContain('72');
    expect(
      vi.mocked(fetch).mock.calls.some(([path]) => String(path) === '/auth/reset-password'),
    ).toBe(false);
  });
});
