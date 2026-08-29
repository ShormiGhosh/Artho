-- Smart Debt Settlement: groups, an immutable ledger of who-owes-whom, and
-- optimized settlements executed through the existing transfer engine.

CREATE TABLE IF NOT EXISTS debt_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  created_by UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS debt_group_members (
  group_id UUID NOT NULL REFERENCES debt_groups (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS debt_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(32) NOT NULL UNIQUE,
  group_id UUID NOT NULL REFERENCES debt_groups (id) ON DELETE CASCADE,
  idempotency_key VARCHAR(255) NOT NULL,
  initiated_by UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  total_outstanding_paisa BIGINT NOT NULL DEFAULT 0,
  original_debt_count INTEGER NOT NULL DEFAULT 0,
  optimized_transfer_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  plan_hash VARCHAR(64) NOT NULL,
  last_progress_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT uq_settlement_idem UNIQUE (group_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_settlement_group ON debt_settlements (group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlement_processing ON debt_settlements (status, last_progress_at)
  WHERE status = 'PROCESSING';

CREATE TABLE IF NOT EXISTS debts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(32) NOT NULL UNIQUE,
  group_id UUID NOT NULL REFERENCES debt_groups (id) ON DELETE CASCADE,
  debtor_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  creditor_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  amount_paisa BIGINT NOT NULL CHECK (amount_paisa > 0),
  description VARCHAR(200),
  kind VARCHAR(20) NOT NULL DEFAULT 'DEBT'
    CHECK (kind IN ('DEBT', 'EXPENSE_SHARE', 'SETTLEMENT_PAYMENT')),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  settlement_id UUID REFERENCES debt_settlements (id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT debt_not_self CHECK (debtor_id <> creditor_id)
);
CREATE INDEX IF NOT EXISTS idx_debts_group_status ON debts (group_id, status);
CREATE INDEX IF NOT EXISTS idx_debts_settlement ON debts (settlement_id);

CREATE TABLE IF NOT EXISTS debt_settlement_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID NOT NULL REFERENCES debt_settlements (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  from_user UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  to_user UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  amount_paisa BIGINT NOT NULL CHECK (amount_paisa > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED')),
  transfer_id UUID REFERENCES transfers (id) ON DELETE SET NULL,
  failure_reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_settlement_transfer_seq UNIQUE (settlement_id, seq),
  CONSTRAINT settlement_transfer_not_self CHECK (from_user <> to_user)
);
CREATE INDEX IF NOT EXISTS idx_settlement_transfer_settlement
  ON debt_settlement_transfers (settlement_id, seq);
