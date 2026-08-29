-- Auth hardening: phone number + email verification, and rotating refresh
-- tokens with reuse detection.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users (phone) WHERE phone IS NOT NULL;

-- New accounts start PENDING_VERIFICATION and are held there by requireAuth
-- (only the verification endpoints + wallet/profile reads allow that status)
-- until the emailed code is confirmed.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_status_check;
ALTER TABLE users
  ADD CONSTRAINT users_account_status_check
  CHECK (account_status IN ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'CLOSED'));

-- Rotating refresh tokens. Only a SHA-256 hash of the opaque token is ever
-- stored. `family_id` groups one continuous rotation chain (one login
-- session); presenting a token that has already been rotated or revoked
-- means the family is compromised, so the whole family is killed.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id UUID NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'ROTATED', 'REVOKED')),
  replaced_by UUID REFERENCES refresh_tokens (id) ON DELETE SET NULL,
  ip_hash VARCHAR(64),
  user_agent_hash VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_reason VARCHAR(40),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_status ON refresh_tokens (status, expires_at);

-- Email verification codes (6-digit numeric, hashed at rest). Multiple rows
-- can exist per user (one per resend); only the latest unconsumed one counts.
CREATE TABLE IF NOT EXISTS email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash VARCHAR(64) NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user
  ON email_verifications (user_id, created_at DESC);
