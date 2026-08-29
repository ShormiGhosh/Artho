-- AI advisory layer: an insight cache (so we don't re-call OpenAI for identical
-- inputs), a safe request log (no prompts, no secrets, no PII), and columns to
-- attach a *secondary* AI fraud analysis to a deterministic risk assessment.
--
-- Nothing here is authoritative. The financial database, the deterministic
-- transfer engine and the deterministic fraud rules remain the source of truth.

CREATE TABLE IF NOT EXISTS ai_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'TRANSFER_INVESTIGATION' | 'FINANCIAL_SUMMARY' | 'FRAUD_ANALYSIS'
  kind VARCHAR(40) NOT NULL,
  -- transfer reference, "<userId>:<period>:<periodStart>", assessment id, ...
  subject VARCHAR(160) NOT NULL,
  -- sha256 of the exact structured input sent to the model; a change busts cache
  input_hash VARCHAR(64) NOT NULL,
  result JSONB NOT NULL,
  source VARCHAR(10) NOT NULL CHECK (source IN ('ai', 'fallback')),
  model VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_ai_insight UNIQUE (kind, subject, input_hash)
);
CREATE INDEX IF NOT EXISTS idx_ai_insights_lookup
  ON ai_insights (kind, subject, input_hash);
CREATE INDEX IF NOT EXISTS idx_ai_insights_expiry ON ai_insights (expires_at);

-- Observability for cost / reliability. Deliberately stores NO prompt text,
-- NO model output, NO API key, NO transaction PII — only counters.
CREATE TABLE IF NOT EXISTS ai_request_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature VARCHAR(40) NOT NULL,
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  model VARCHAR(80),
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('ok', 'fallback', 'error', 'cache')),
  error_code VARCHAR(40),
  duration_ms INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_request_log_feature
  ON ai_request_log (feature, created_at DESC);

-- Secondary, advisory AI opinion attached to a deterministic risk assessment.
-- The deterministic score / band / decision are unchanged and still authoritative.
ALTER TABLE transfer_risk_assessments
  ADD COLUMN IF NOT EXISTS signals JSONB,
  ADD COLUMN IF NOT EXISTS ai_analysis JSONB,
  ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMPTZ;
