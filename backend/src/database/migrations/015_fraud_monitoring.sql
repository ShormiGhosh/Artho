-- Fraud & Security Monitoring: configurable risk thresholds, an auditable
-- security event log, per-transfer risk assessments, and known-session tracking.

CREATE TABLE IF NOT EXISTS risk_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  medium_threshold INTEGER NOT NULL DEFAULT 20,
  high_threshold INTEGER NOT NULL DEFAULT 55,
  large_amount_paisa BIGINT NOT NULL DEFAULT 5000000,       -- BDT 50,000
  hard_cap_paisa BIGINT NOT NULL DEFAULT 50000000,          -- BDT 500,000 (critical)
  velocity_window_minutes INTEGER NOT NULL DEFAULT 10,
  velocity_max_transfers INTEGER NOT NULL DEFAULT 5,
  failed_window_minutes INTEGER NOT NULL DEFAULT 15,
  failed_max_transfers INTEGER NOT NULL DEFAULT 3,
  new_recipient_window_days INTEGER NOT NULL DEFAULT 7,
  failed_login_window_minutes INTEGER NOT NULL DEFAULT 60,
  failed_login_max INTEGER NOT NULL DEFAULT 5,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL
);
INSERT INTO risk_config (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  type VARCHAR(40) NOT NULL,
  severity VARCHAR(10) NOT NULL DEFAULT 'INFO'
    CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH')),
  ip_hash VARCHAR(64),
  user_agent_hash VARCHAR(64),
  transfer_reference VARCHAR(32),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events (type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events (severity, created_at DESC);

CREATE TABLE IF NOT EXISTS transfer_risk_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(32) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  idempotency_key VARCHAR(255) NOT NULL,
  receiver_id UUID REFERENCES users (id) ON DELETE SET NULL,
  amount_paisa BIGINT NOT NULL,
  score INTEGER NOT NULL,
  band VARCHAR(10) NOT NULL CHECK (band IN ('LOW', 'MEDIUM', 'HIGH')),
  decision VARCHAR(20) NOT NULL
    CHECK (decision IN ('ALLOWED', 'PENDING_VERIFICATION', 'VERIFIED', 'BLOCKED', 'RELEASED')),
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  verification_token VARCHAR(64),
  transfer_id UUID REFERENCES transfers (id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_risk_assessment UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_risk_band ON transfer_risk_assessments (band, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_decision ON transfer_risk_assessments (decision, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_user ON transfer_risk_assessments (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS known_sessions (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ip_hash VARCHAR(64) NOT NULL,
  user_agent_hash VARCHAR(64) NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, ip_hash, user_agent_hash)
);
