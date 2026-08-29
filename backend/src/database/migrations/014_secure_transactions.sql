-- Secure Transactions: encrypt NID at rest, blind index for lookups, session
-- invalidation on password change, admin role, security-alert notifications.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS nid_enc TEXT,
  ADD COLUMN IF NOT EXISTS nid_bidx VARCHAR(64),
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_users_nid_bidx ON users (nid_bidx);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (role IN ('USER', 'INSTITUTION', 'ADMIN'));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('TRANSFER_RECEIVED', 'REQUEST_RECEIVED', 'REQUEST_APPROVED',
                  'REQUEST_REJECTED', 'REQUEST_CANCELLED', 'REQUEST_EXPIRED',
                  'STIPEND_RECEIVED', 'SECURITY_ALERT'));
