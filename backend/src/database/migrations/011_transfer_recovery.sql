-- Smart Money Recovery: an in-flight/uncertain state, a re-attempt counter, and
-- an append-only audit trail of every state transition per transfer.

ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_status_check;
ALTER TABLE transfers
  ADD CONSTRAINT transfers_status_check
  CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'VERIFYING'));

ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS transfer_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES transfers (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  state VARCHAR(20) NOT NULL
    CHECK (state IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'VERIFYING')),
  event VARCHAR(40) NOT NULL
    CHECK (event IN ('INITIATED', 'BALANCE_LOCKED', 'PROCESSED', 'COMPLETED',
                     'FAILED', 'CLIENT_CONFIRMATION_LOST', 'VERIFIED')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_transfer_event_seq UNIQUE (transfer_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_transfer_events_transfer
  ON transfer_events (transfer_id, seq);

-- Backfill a minimal trail for transfers that predate this table so their
-- timelines are not blank.
INSERT INTO transfer_events (transfer_id, seq, state, event, detail, created_at)
SELECT t.id, 1, 'PENDING', 'INITIATED', '{"backfilled":true}'::jsonb, t.created_at
  FROM transfers t
 WHERE NOT EXISTS (SELECT 1 FROM transfer_events e WHERE e.transfer_id = t.id);

INSERT INTO transfer_events (transfer_id, seq, state, event, detail, created_at)
SELECT t.id, 2,
       CASE t.status WHEN 'COMPLETED' THEN 'COMPLETED' WHEN 'FAILED' THEN 'FAILED' ELSE t.status END,
       CASE t.status WHEN 'COMPLETED' THEN 'COMPLETED' WHEN 'FAILED' THEN 'FAILED' ELSE 'INITIATED' END,
       jsonb_build_object('backfilled', true, 'failure_reason', t.failure_reason),
       t.updated_at
  FROM transfers t
 WHERE t.status IN ('COMPLETED', 'FAILED')
   AND (SELECT COUNT(*) FROM transfer_events e WHERE e.transfer_id = t.id) = 1;
