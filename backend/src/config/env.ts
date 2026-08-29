import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: parseInt(process.env.PORT ?? '3000', 10),
  DATABASE_URL: required(
    'DATABASE_URL',
    'postgresql://artho:artho@localhost:5544/artho'
  ),
  DB_POOL_MIN: parseInt(process.env.DB_POOL_MIN ?? '2', 10),
  DB_POOL_MAX: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
  JWT_SECRET: required('JWT_SECRET', 'dev-super-secret-key-min-32-chars-change-me'),
  /** Access token lifetime, seconds. Short-lived by design — session length comes
   *  from the refresh token instead (see REFRESH_TOKEN_TTL_DAYS). */
  JWT_EXPIRATION: parseInt(process.env.JWT_EXPIRATION ?? '900', 10),
  /** Rotating refresh token lifetime. */
  REFRESH_TOKEN_TTL_DAYS: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS ?? '30', 10),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  INITIAL_BALANCE_PAISA: BigInt(process.env.INITIAL_BALANCE_PAISA ?? '10000000'),

  /** AES-256-GCM key (32 bytes) for encrypting PII at rest. Hex or base64. */
  PII_ENCRYPTION_KEY:
    process.env.PII_ENCRYPTION_KEY ??
    'dev-pii-key-000000000000000000000000000000000000000000000000000000',
  /** HMAC key for blind-index lookups of encrypted fields. */
  PII_BLIND_INDEX_KEY:
    process.env.PII_BLIND_INDEX_KEY ?? 'dev-blind-index-key-change-me-in-production',
  /** Reject plain-HTTP requests (behind a TLS-terminating proxy). */
  ENFORCE_HTTPS: (process.env.ENFORCE_HTTPS ?? 'false') === 'true',

  // ---------------------------------------------------------------------------
  // OpenAI — advisory/explanation layer only. The app runs fully without it:
  // when OPENAI_API_KEY is unset (or the API fails) every AI feature falls back
  // to a deterministic explanation and core money movement is unaffected.
  // The key is read ONLY here, server-side, and is never logged or returned.
  // ---------------------------------------------------------------------------
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  /** Cost-efficient default suitable for these high-volume, low-stakes tasks. */
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  OPENAI_BASE_URL: (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
  OPENAI_TIMEOUT_MS: parseInt(process.env.OPENAI_TIMEOUT_MS ?? '12000', 10),
  OPENAI_MAX_RETRIES: parseInt(process.env.OPENAI_MAX_RETRIES ?? '2', 10),
  /** Per-user cap on AI endpoint calls, per minute. */
  AI_RATE_LIMIT_PER_MIN: parseInt(process.env.AI_RATE_LIMIT_PER_MIN ?? '12', 10),

  // ---------------------------------------------------------------------------
  // Email verification. Codes are always generated and stored server-side;
  // SMTP is optional — unconfigured, EmailService logs the code instead of
  // sending it (see services/email/emailService.ts) so the app still runs.
  // ---------------------------------------------------------------------------
  SMTP_HOST: process.env.SMTP_HOST ?? '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT ?? '587', 10),
  SMTP_USER: process.env.SMTP_USER ?? '',
  SMTP_PASS: process.env.SMTP_PASS ?? '',
  SMTP_FROM: process.env.SMTP_FROM ?? 'Artho <no-reply@artho.app>',
  EMAIL_VERIFICATION_TTL_MINUTES: parseInt(process.env.EMAIL_VERIFICATION_TTL_MINUTES ?? '15', 10),
  EMAIL_VERIFICATION_MAX_ATTEMPTS: parseInt(process.env.EMAIL_VERIFICATION_MAX_ATTEMPTS ?? '5', 10),
  EMAIL_VERIFICATION_RESEND_COOLDOWN_S: parseInt(
    process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN_S ?? '60',
    10
  ),
};

/**
 * Dev/test-only convenience: when SMTP isn't configured (or we're simply not in
 * production), verification endpoints echo the code back in the response body
 * so the flow is testable without a real mailbox. Never active in production,
 * regardless of SMTP configuration.
 */
export function exposeDevVerificationCode(): boolean {
  return env.NODE_ENV !== 'production';
}

/**
 * True when the OpenAI integration is configured. Read live from the environment
 * so tests can toggle it, and so a key added after boot takes effect. Never
 * exposes the key value itself.
 */
export function aiConfigured(): boolean {
  return (process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY ?? '').trim().length > 0;
}

/** @deprecated prefer `aiConfigured()` — kept for boot-time checks. */
export const AI_ENABLED = aiConfigured();
