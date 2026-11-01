import { vi } from 'vitest';
import * as email from '../../src/services/email.js';

export function captureOrgVerificationEmails() {
  const sent = vi.spyOn(email, 'sendVerificationEmail');
  return {
    tokenFor(orgId: string): string {
      const message = [...sent.mock.calls].reverse().find((call) => call[2] === orgId);
      if (!message) throw new Error(`No verification email for ${orgId}`);
      return message[1];
    },
    restore: () => sent.mockRestore(),
  };
}
