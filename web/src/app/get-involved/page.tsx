import type { Metadata } from 'next';
import { PageShell } from '@/components/PageShell';
import { CommunityForm } from '@/components/CommunityForm';

export const metadata: Metadata = {
  title: 'Get involved',
  description: 'Sign up to contribute to NandaIndex, discuss a partnership, join a working group, or ask a question.',
};

export default function GetInvolvedPage() {
  return (
    <PageShell title="Get involved" description="Contribute, explore a partnership, join a working group, or ask a question.">
      <div className="max-w-2xl">
        <p className="mb-8 text-base leading-relaxed text-ink-medium">
          Use the form below to contact the NandaIndex team. You do not need an Index account.
        </p>
        <CommunityForm />
      </div>
    </PageShell>
  );
}
