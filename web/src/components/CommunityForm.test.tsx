// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommunityForm } from './CommunityForm';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fillForm() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alice@example.org' } });
  fireEvent.change(screen.getByLabelText('I would like to'), { target: { value: 'contribute' } });
  fireEvent.change(screen.getByLabelText('Message (optional)'), { target: { value: 'I can help test agent discovery.' } });
}

describe('community signup form', () => {
  it('keeps contact details out of the URL if JavaScript cannot handle submission', () => {
    const { container } = render(<CommunityForm />);
    expect(container.querySelector('form')!.method).toBe('post');
  });

  it('submits the visitor’s interest and shows confirmation after the API accepts it', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'accepted' }), { status: 202 }));
    vi.stubGlobal('fetch', fetch);
    render(<CommunityForm />);
    fillForm();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Trust and identity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Your request was submitted'));
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toMatch(/\/api\/v1\/community-interest$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({
      name: 'Alice', email: 'alice@example.org', interest: 'contribute',
      working_groups: ['trust-identity'], message: 'I can help test agent discovery.',
    });
  });

  it('preserves input and offers the contact email when delivery fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    render(<CommunityForm />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('vedh@vedhkrishnan.com'));
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('alice@example.org');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('disables submission while a request is pending', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<CommunityForm />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect((screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
