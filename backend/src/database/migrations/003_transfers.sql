CREATE TABLE IF NOT EXISTS transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(32) NOT NULL UNIQUE,
  sender_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  receiver_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  amount_paisa BIGINT NOT NULL CHECK (amount_paisa > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  type VARCHAR(30) NOT NULL DEFAULT 'TRANSFER'
    CHECK (type IN ('TRANSFER', 'REQUEST_APPROVAL')),
  note VARCHAR(500),
  idempotency_key VARCHAR(255) NOT NULL,
  sender_balance_before BIGINT,
  sender_balance_after BIGINT,
  receiver_balance_before BIGINT,
  receiver_balance_after BIGINT,
  failure_reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT not_self_transfer CHECK (sender_id <> receiver_id),
  CONSTRAINT uq_transfer_idempotency UNIQUE (sender_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_transfer_sender ON transfers (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_receiver ON transfers (receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_status ON transfers (status, created_at DESC);
