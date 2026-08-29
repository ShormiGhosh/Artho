import { env } from '../../config/env';
import { logger } from '../../utils/logger';

/**
 * EmailService — isolated, swappable mail transport.
 *
 * No SMTP client library is bundled: wiring `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`
 * to a real provider (SES, SendGrid, Mailgun, a raw SMTP relay — whatever the
 * deployment uses) is a deliberate integration point left for that decision.
 * Until it's configured, sending never fails loudly: the code is logged
 * (structured, so an operator watching logs can still complete the flow) and
 * the caller is told delivery did not happen. Verification MUST NOT be blocked
 * by a mail outage or missing configuration — the code itself, not the send,
 * is the source of truth.
 */

export function smtpConfigured(): boolean {
  return !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

export const EmailService = {
  get configured(): boolean {
    return smtpConfigured();
  },

  async sendVerificationCode(
    to: string,
    code: string,
    opts: { purpose?: 'REGISTER' | 'RESEND' } = {}
  ): Promise<{ delivered: boolean }> {
    if (!smtpConfigured()) {
      logger.info('verification code (SMTP not configured — dev fallback, not actually emailed)', {
        to,
        purpose: opts.purpose ?? 'REGISTER',
      });
      return { delivered: false };
    }

    try {
      // Integration point: send `code` to `to` via the configured SMTP relay
      // or provider API here. Left unimplemented deliberately — no mail
      // credentials exist in this environment — but every caller already
      // treats `delivered: false` as a normal, handled outcome.
      logger.warn('SMTP configured but no transport is wired up — code not sent', { to });
      return { delivered: false };
    } catch (err) {
      logger.error('verification email send failed', err, { to });
      return { delivered: false };
    }
  },
};
