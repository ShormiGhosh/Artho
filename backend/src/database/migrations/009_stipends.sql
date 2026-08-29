-- Accounts gain a role (individual vs. an institution that can run stipend
-- programmes) and an optional National ID for guardian/NID linkage.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'USER'
    CHECK (role IN ('USER', 'INSTITUTION')),
  ADD COLUMN IF NOT EXISTS nid VARCHAR(30);

-- Stipend / scholarship / grant disbursements are transfers with their own type
-- so they can be identified (badging, "no cash-out fee" messaging, reporting).
ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_type_check;
ALTER TABLE transfers
  ADD CONSTRAINT transfers_type_check
  CHECK (type IN ('TRANSFER', 'REQUEST_APPROVAL', 'STIPEND'));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('TRANSFER_RECEIVED', 'REQUEST_RECEIVED', 'REQUEST_APPROVED',
                  'REQUEST_REJECTED', 'REQUEST_CANCELLED', 'REQUEST_EXPIRED',
                  'STIPEND_RECEIVED'));

CREATE TABLE IF NOT EXISTS stipend_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(32) NOT NULL UNIQUE,
  owner_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(20) NOT NULL DEFAULT 'STIPEND'
    CHECK (category IN ('STIPEND', 'SCHOLARSHIP', 'GRANT')),
  description VARCHAR(500),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stipend_program_owner ON stipend_programs (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stipend_beneficiaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES stipend_programs (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  guardian_nid VARCHAR(30) NOT NULL,
  institution_name VARCHAR(150) NOT NULL,
  default_amount_paisa BIGINT CHECK (default_amount_paisa IS NULL OR default_amount_paisa > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REMOVED')),
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_program_beneficiary UNIQUE (program_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_stipend_beneficiary_program ON stipend_beneficiaries (program_id, status);
CREATE INDEX IF NOT EXISTS idx_stipend_beneficiary_user ON stipend_beneficiaries (user_id);

CREATE TABLE IF NOT EXISTS stipend_disbursements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(32) NOT NULL UNIQUE,
  program_id UUID NOT NULL REFERENCES stipend_programs (id) ON DELETE RESTRICT,
  initiated_by UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  note VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING'
    CHECK (status IN ('PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  total_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  total_amount_paisa BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_stipend_disbursement_program ON stipend_disbursements (program_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stipend_disbursement_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disbursement_id UUID NOT NULL REFERENCES stipend_disbursements (id) ON DELETE CASCADE,
  beneficiary_id UUID NOT NULL REFERENCES stipend_beneficiaries (id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  amount_paisa BIGINT NOT NULL CHECK (amount_paisa > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'SKIPPED')),
  transfer_id UUID REFERENCES transfers (id) ON DELETE SET NULL,
  failure_reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_disbursement_beneficiary UNIQUE (disbursement_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_disbursement_item_disb ON stipend_disbursement_items (disbursement_id);
CREATE INDEX IF NOT EXISTS idx_disbursement_item_user ON stipend_disbursement_items (user_id, created_at DESC);
