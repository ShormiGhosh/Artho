CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL
    CHECK (type IN ('TRANSFER_RECEIVED', 'REQUEST_RECEIVED', 'REQUEST_APPROVED',
                    'REQUEST_REJECTED', 'REQUEST_CANCELLED', 'REQUEST_EXPIRED')),
  related_transfer_id UUID REFERENCES transfers (id) ON DELETE SET NULL,
  related_request_id UUID REFERENCES money_requests (id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_user ON notifications (user_id, is_read, created_at DESC);
