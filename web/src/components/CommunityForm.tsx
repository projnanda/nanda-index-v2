"use client";

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { workingGroups } from '@/lib/community';

const inputClass = 'mt-2 block w-full rounded-control border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-brand-600 focus:outline-2 focus:outline-brand-600';
const apiBase = process.env.NEXT_PUBLIC_NANDA_INDEX_API_URL ?? '';

export function CommunityForm() {
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/v1/community-interest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(data.get('name') ?? '').trim(), email: String(data.get('email') ?? '').trim(),
          organization: String(data.get('organization') ?? '').trim(), interest: data.get('interest'),
          working_groups: data.getAll('working_groups'), message: String(data.get('message') ?? '').trim(),
          website: data.get('website') ?? '',
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        setError(response.status === 429
          ? 'Too many requests. Please try again later.'
          : 'Your request could not be sent. Please try again.');
        return;
      }
      const result = await response.json();
      if (result.status !== 'accepted') throw new Error('Unexpected response');
      form.reset();
      setSubmitted(true);
    } catch {
      setError('We could not confirm your submission. Please try again.');
    } finally {
      setPending(false);
    }
  }

  if (submitted) return (
    <div role="status" className="rounded-card border border-line bg-surface-light p-6 text-ink">
      <p className="font-semibold">Your request was submitted.</p>
    </div>
  );

  return (
    <form method="post" onSubmit={submit} className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="text-sm font-medium text-ink">Name
          <input name="name" autoComplete="name" required maxLength={120} className={inputClass} />
        </label>
        <label className="text-sm font-medium text-ink">Email
          <input name="email" type="email" autoComplete="email" required maxLength={254} className={inputClass} />
        </label>
      </div>
      <label className="block text-sm font-medium text-ink">Organization (optional)
        <input name="organization" autoComplete="organization" maxLength={160} className={inputClass} />
      </label>
      <label className="block text-sm font-medium text-ink">I would like to
        <select name="interest" required defaultValue="" className={inputClass}>
          <option value="" disabled>Select an option</option>
          <option value="contribute">Contribute</option>
          <option value="partner">Explore a partnership</option>
          <option value="question">Ask a question</option>
        </select>
      </label>
      <fieldset>
        <legend className="text-sm font-medium text-ink">Working groups (optional)</legend>
        <div className="mt-3 space-y-3">
          {workingGroups.map((group) => (
            <label key={group.id} className="flex items-start gap-3 text-sm text-ink-medium">
              <input type="checkbox" name="working_groups" value={group.id} className="mt-0.5 size-4 accent-brand-800" />
              {group.title}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm font-medium text-ink">Message (optional)
        <textarea name="message" rows={5} maxLength={4000} className={inputClass} />
      </label>
      <div hidden aria-hidden="true">
        <label>Leave this field empty<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <p className="text-sm leading-relaxed text-ink-medium">
        Your details will be emailed to the NandaIndex team so we can respond to your request.
        {' '}They will not be published in the Index. <Link href="/privacy" className="text-brand-600 underline">Privacy details</Link>.
      </p>
      {error && <p role="alert" className="rounded-control border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center justify-center rounded-control bg-brand-800 px-6 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-wait disabled:opacity-60">
        {pending ? 'Sending…' : 'Send request'}
      </button>
    </form>
  );
}
