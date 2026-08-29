CREATE TABLE IF NOT EXISTS money_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(32) NOT NULL UNIQUE,
  requester_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  requestee_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  amount_paisa BIGINT NOT NULL CHECK (amount_paisa > 0),
  reason VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
  related_transfer_id UUID REFERENCES transfers (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT not_self_request CHECK (requester_id <> requestee_id)
);

CREATE INDEX IF NOT EXISTS idx_request_requester ON money_requests (requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_requestee ON money_requests (requestee_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_expiry ON money_requests (expires_at) WHERE status = 'PENDING';
