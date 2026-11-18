import { Resend } from 'resend';
import { buildConfig } from '../config/index.js';

export interface CommunityInterest {
  name: string;
  email: string;
  organization?: string;
  interest: 'contribute' | 'partner' | 'question';
  working_groups?: ('discovery' | 'trust-identity' | 'use-cases')[];
  message?: string;
}

const interests = { contribute: 'Contribute', partner: 'Partner', question: 'Ask a question' };
const groups = {
  discovery: 'Discovery without DNS anchored agents',
  'trust-identity': 'Trust and identity',
  'use-cases': 'Use cases',
};

export async function sendCommunityInterestEmail(request: CommunityInterest): Promise<void> {
  const { email } = buildConfig();
  // A contact form must not report success when development log mode discards the message.
  if (email.smtpUrl === 'log') throw new Error('Contact email delivery is not configured');
  if (!email.communityTo) throw new Error('Contact email recipient is not configured');
  const { data, error } = await new Resend(email.smtpUrl).emails.send({
    from: email.fromAddress,
    to: email.communityTo,
    ...(email.communityCc.length ? { cc: [...email.communityCc] } : {}),
    replyTo: request.email,
    subject: `NandaIndex: ${interests[request.interest]}`,
    text: [
      `Name: ${request.name}`, `Email: ${request.email}`,
      `Organization: ${request.organization || 'Not provided'}`,
      `Interest: ${interests[request.interest]}`,
      `Working groups: ${request.working_groups?.map((id) => groups[id]).join(', ') || 'Not selected'}`,
      '', request.message || 'No additional message.',
    ].join('\n'),
  });
  if (error || !data?.id) throw new Error('Contact email delivery failed');
}
