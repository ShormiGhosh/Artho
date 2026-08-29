CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  amount_paisa BIGINT NOT NULL CHECK (amount_paisa <> 0),
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
  transfer_id UUID REFERENCES transfers (id) ON DELETE RESTRICT,
  entry_type VARCHAR(30) NOT NULL
    CHECK (entry_type IN ('TRANSFER_DEBIT', 'TRANSFER_CREDIT', 'INITIAL_FUNDING', 'CORRECTION')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_transfer ON ledger_entries (transfer_id);
