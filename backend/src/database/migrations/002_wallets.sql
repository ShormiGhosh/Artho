CREATE TABLE IF NOT EXISTS wallets (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE RESTRICT,
  balance_paisa BIGINT NOT NULL DEFAULT 10000000,
  currency VARCHAR(3) NOT NULL DEFAULT 'BDT',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT balance_non_negative CHECK (balance_paisa >= 0),
  CONSTRAINT balance_within_bigint CHECK (balance_paisa <= 9223372036854775807)
);

CREATE INDEX IF NOT EXISTS idx_wallet_updated ON wallets (updated_at DESC);
