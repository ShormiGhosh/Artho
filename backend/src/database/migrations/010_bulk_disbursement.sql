-- Bulk disbursement + resumable, exactly-once delivery.
--
-- `idempotency_key` is stored ON the disbursement row (not just in the HTTP
-- idempotency middleware) and made unique per programme, so retrying a batch —
-- or resuming one after a crash — always lands on the SAME disbursement id, and
-- therefore the same per-item transfer keys `dsb-<disbursementId>-<userId>`.
ALTER TABLE stipend_disbursements
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'STANDARD'
    CHECK (mode IN ('STANDARD', 'BULK')),
  ADD COLUMN IF NOT EXISTS unresolved JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS processed_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ;

-- Multiple legacy rows may have NULL keys; Postgres allows many NULLs in a
-- UNIQUE index, so this is safe to add retroactively.
ALTER TABLE stipend_disbursements
  DROP CONSTRAINT IF EXISTS uq_disbursement_idem;
ALTER TABLE stipend_disbursements
  ADD CONSTRAINT uq_disbursement_idem UNIQUE (program_id, idempotency_key);

-- Finds crashed batches to resume.
CREATE INDEX IF NOT EXISTS idx_disbursement_processing
  ON stipend_disbursements (status, last_progress_at)
  WHERE status = 'PROCESSING';
