export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string; details?: unknown };
  request_id?: string;
}

export interface Wallet {
  balance_paisa: string;
  balance_bdt: string;
  balance_display: string;
  currency: string;
  updated_at: string;
}

export type UserRole = 'USER' | 'INSTITUTION';

export interface Me {
  user_id: string;
  email: string;
  full_name: string;
  account_status: string;
  role: UserRole;
  nid: string | null;
  created_at: string;
  wallet: Wallet;
}

export interface UserResult {
  user_id: string;
  full_name: string;
  email: string;
}

export interface Transfer {
  transfer_id: string;
  reference: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  type: string;
  is_stipend?: boolean;
  fee_bdt?: string;
  direction: 'SENT' | 'RECEIVED';
  amount_bdt: string;
  amount_display: string;
  note: string | null;
  failure_reason: string | null;
  your_balance_before_bdt: string | null;
  your_balance_after_bdt: string | null;
  created_at: string;
  other_party?: string;
  counterparty?: { user_id: string; full_name: string };
}

export interface MoneyRequest {
  request_id: string;
  reference: string;
  direction: 'SENT' | 'RECEIVED';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
  requester_id: string;
  requestee_id: string;
  amount_bdt: string;
  amount_display: string;
  reason: string | null;
  counterparty_name?: string;
  requester_name?: string;
  requestee_name?: string;
  related_transfer_id: string | null;
  related_transfer_reference: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  resolved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface HistoryItem {
  kind: 'TRANSFER' | 'REQUEST';
  id: string;
  reference: string;
  direction: 'SENT' | 'RECEIVED';
  badge: string;
  is_stipend?: boolean;
  counterparty_name: string;
  amount_display: string;
  amount_bdt: string;
  status: string;
  note?: string | null;
  reason?: string | null;
  failure_reason?: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  related_transfer_id: string | null;
  related_request_id: string | null;
}

export type StipendCategory = 'STIPEND' | 'SCHOLARSHIP' | 'GRANT';

export interface StipendProgram {
  program_id: string;
  reference: string;
  owner_id: string;
  owner_name?: string;
  name: string;
  category: StipendCategory;
  description: string | null;
  status: 'ACTIVE' | 'CLOSED';
  created_at: string;
  updated_at: string;
  beneficiary_count?: number;
  disbursement_count?: number;
  total_disbursed_bdt?: string;
  is_owner?: boolean;
  my_enrollment?: {
    status: string;
    institution_name: string;
    guardian_nid: string;
    default_amount_bdt: string | null;
  } | null;
}

export interface Beneficiary {
  beneficiary_id: string;
  program_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  account_status: string;
  guardian_nid: string;
  institution_name: string;
  default_amount_bdt: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  eligible: boolean;
  enrolled_at: string;
}

export interface DisbursementItem {
  item_id: string;
  user_id: string;
  user_name: string;
  amount_bdt: string;
  amount_display: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'SKIPPED';
  failure_reason: string | null;
  transfer_reference: string | null;
}

export interface UnresolvedRow {
  row: Record<string, unknown>;
  reason: string;
}

export interface Disbursement {
  disbursement_id: string;
  reference: string;
  program_id: string;
  program_name?: string;
  category?: StipendCategory;
  mode?: 'STANDARD' | 'BULK';
  note: string | null;
  status: 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  total_count: number;
  processed_count?: number;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  unresolved?: UnresolvedRow[];
  unresolved_count?: number;
  total_amount_bdt: string;
  created_at: string;
  completed_at: string | null;
  items?: DisbursementItem[];
  replayed?: boolean;
  async?: boolean;
}

export interface BulkPreview {
  dry_run: true;
  program_reference: string;
  resolved_count: number;
  unresolved_count: number;
  will_auto_enroll: number;
  total_amount_bdt: string;
  resolved: Array<{
    user_id: string;
    user_name: string;
    amount_bdt: string;
    new_beneficiary: boolean;
  }>;
  unresolved: UnresolvedRow[];
}

export interface StipendReceived {
  total_received_bdt: string;
  payments: Array<{
    transfer_id: string;
    reference: string;
    amount_bdt: string;
    amount_display: string;
    note: string | null;
    from_name: string;
    program_name: string | null;
    program_reference: string | null;
    category: StipendCategory | null;
    created_at: string;
    fee_bdt: string;
  }>;
  enrollments: Array<{
    program_name: string;
    program_reference: string;
    category: StipendCategory;
    owner_name: string;
    status: string;
    institution_name: string;
    guardian_nid: string;
    default_amount_bdt: string | null;
    enrolled_at: string;
  }>;
}
