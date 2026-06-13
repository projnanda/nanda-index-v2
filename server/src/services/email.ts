import { Resend } from 'resend';
import { buildConfig } from '../config/index.js';

export async function sendVerificationEmail(
  to: string,
  token: string,
  orgId: string,
): Promise<void> {
  const config = buildConfig();
  const verifyUrl = `${config.oauth.callbackBaseUrl}/api/v1/verify-email?token=${token}`;

  if (config.email.smtpUrl === 'log') {
    console.log(`[email] verification link for org "${orgId}" → ${verifyUrl}`);
    return;
  }

  const resend = new Resend(config.email.smtpUrl);
  const { error } = await resend.emails.send({
    from:    config.email.fromAddress,
    to,
    subject: `Verify your NANDA Index registration for ${orgId}`,
    text:    `Click to verify your email and activate your organization:\n\n${verifyUrl}\n\nThis link is valid for 24 hours.`,
    html:    `<p>Click the link below to verify your email and activate your organization on the NANDA Index:</p>
              <p><a href="${verifyUrl}">${verifyUrl}</a></p>
              <p>This link is valid for 24 hours.</p>`,
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}
