import nodemailer from 'nodemailer';
import { buildConfig } from '../config/index.js';

/**
 * Sends an email verification link to the org's contact address.
 * When SMTP_URL='log' (default in dev), prints the link to console instead of sending.
 *
 * @param to - recipient email address
 * @param token - 32-byte hex verify token stored on the organization row
 * @param orgId - org slug, included in the email body for context
 */
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

  const transport = nodemailer.createTransport(config.email.smtpUrl);
  await transport.sendMail({
    from:    config.email.fromAddress,
    to,
    subject: `Verify your NANDA Index registration for ${orgId}`,
    text:    `Click to verify your email and activate your organization:\n\n${verifyUrl}\n\nThis link is valid for 24 hours.`,
    html:    `<p>Click the link below to verify your email and activate your organization on the NANDA Index:</p>
              <p><a href="${verifyUrl}">${verifyUrl}</a></p>
              <p>This link is valid for 24 hours.</p>`,
  });
}
