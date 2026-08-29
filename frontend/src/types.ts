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

export type UserRole = 'USER' | 'INSTITUTION' | 'ADMIN';

export interface Me {
  user_id: string;
  email: string;
  phone: string | null;
  full_name: string;
  account_status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED' | string;
  role: UserRole;
  nid: string | null; // masked, e.g. "•••••••••4333"
  has_nid?: boolean;
  created_at: string;
  wallet: Wallet;
}

export interface RiskReason {
  code: string;
  label: string;
  weight: number;
  critical: boolean;
  detail: Record<string, unknown>;
}

export interface RiskInfo {
  band?: 'LOW' | 'MEDIUM' | 'HIGH';
  decision?: string;
  score?: number;
  reasons?: RiskReason[];
  assessment_reference?: string;
  verification_token?: string;
}

export interface RiskAssessmentRow {
  assessment_id: string;
  reference: string;
  user_id: string;
  user_name?: string;
  receiver_name?: string;
  amount_bdt: string;
  amount_display: string;
  score: number;
  band: 'LOW' | 'MEDIUM' | 'HIGH';
  decision: 'ALLOWED' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'BLOCKED' | 'RELEASED';
  reasons: RiskReason[];
  transfer_reference?: string | null;
  review_note?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  related_events?: SecurityEventRow[];
  user_email?: string;
  ai_analysis?: AiFraudAnalysis | null;
  ai_analyzed_at?: string | null;
  ai_available?: boolean;
}

export interface SecurityEventRow {
  id: string;
  type: string;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';
  user_name?: string | null;
  transfer_reference?: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface SecurityDashboard {
  last_24h_by_band: Record<string, number>;
  by_decision: Record<string, number>;
  currently_blocked: number;
  last_24h_events_by_severity: Record<string, number>;
  flagged: RiskAssessmentRow[];
}

export interface RiskConfig {
  medium_threshold: number;
  high_threshold: number;
  large_amount_paisa: string;
  hard_cap_paisa: string;
  large_amount_bdt: string;
  hard_cap_bdt: string;
  velocity_window_minutes: number;
  velocity_max_transfers: number;
  failed_window_minutes: number;
  failed_max_transfers: number;
  new_recipient_window_days: number;
  failed_login_window_minutes: number;
  failed_login_max: number;
}

export interface UserResult {
  user_id: string;
  full_name: string;
  email: string;
}

export type TransferStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'VERIFYING';

export interface TransferEvent {
  seq: number;
  state: TransferStatus;
  event:
    | 'INITIATED'
    | 'BALANCE_LOCKED'
    | 'PROCESSED'
    | 'COMPLETED'
    | 'FAILED'
    | 'CLIENT_CONFIRMATION_LOST'
    | 'VERIFIED';
  detail: Record<string, unknown>;
  created_at: string;
}

export interface Transfer {
  transfer_id: string;
  reference: string;
  status: TransferStatus;
  type: string;
  is_stipend?: boolean;
  is_uncertain?: boolean;
  attempt_count?: number;
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
  events?: TransferEvent[];
}

export interface VerifyResult {
  transfer: Transfer;
  outcome: 'DELIVERED' | 'NOT_SENT' | 'INDETERMINATE';
  reconciliation: {
    ledger_entry_count: number;
    net_ledger_paisa: string;
    money_moved: boolean;
    snapshot_consistent: boolean;
  };
  timeline: TransferEvent[];
}

// ---------------------------------------------------------------------------
// AI advisory layer (OpenAI). Every field here is explanatory only — the
// deterministic values alongside it (outcome, reconciliation, totals, risk
// score) remain authoritative.
// ---------------------------------------------------------------------------

export interface AiStatus {
  enabled: boolean;
  model: string | null;
}

export type AiSource = 'ai' | 'fallback';
export type AiMoneyStatus = 'DELIVERED' | 'SAFE' | 'NEEDS_VERIFICATION';

export interface AiInvestigation {
  transfer: Transfer;
  outcome: 'DELIVERED' | 'NOT_SENT' | 'INDETERMINATE';
  reconciliation: VerifyResult['reconciliation'];
  timeline: TransferEvent[];
  ai: {
    available: boolean;
    source: AiSource;
    model: string | null;
    summary: string;
    timeline_explained: string[];
    money_status: AiMoneyStatus;
    what_this_means: string;
  };
}

export interface AiFraudAnalysis {
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasoning_summary: string;
  risk_factors: string[];
  recommended_action: string;
  source: AiSource;
  model: string | null;
  note: string;
  analyzed_at: string;
}

export interface FinancialSummary {
  period: 'weekly' | 'monthly';
  range: { from: string; to: string; label: string };
  totals: { sent_bdt: string; received_bdt: string; net_bdt: string };
  top_category: { name: string; amount_bdt: string } | null;
  categories: Array<{ name: string; amount_bdt: string }>;
  comparison: { previous_sent_bdt: string; change_pct: number } | null;
  counts: { sent: number; received: number };
  ai: {
    available: boolean;
    source: AiSource;
    model: string | null;
    headline: string;
    observations: string[];
    spending_note: string;
  };
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

export interface DebtBalance {
  user_id: string;
  full_name: string;
  net_bdt: string;
  net_display: string;
  role: 'CREDITOR' | 'DEBTOR' | 'SETTLED';
}

export interface Debt {
  debt_id: string;
  reference: string;
  debtor_id: string;
  debtor_name: string;
  creditor_id: string;
  creditor_name: string;
  amount_bdt: string;
  amount_display: string;
  description: string | null;
  kind: 'DEBT' | 'EXPENSE_SHARE' | 'SETTLEMENT_PAYMENT';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  settlement_reference: string | null;
  created_at: string;
}

export interface DebtGroupSummary {
  group_id: string;
  reference: string;
  name: string;
  member_count: number;
  created_at: string;
  total_outstanding_bdt: string;
  my_net_bdt: string;
  my_role: 'CREDITOR' | 'DEBTOR' | 'SETTLED';
}

export interface DebtGroup {
  group_id: string;
  reference: string;
  name: string;
  created_by: string;
  created_at: string;
  members: { user_id: string; full_name: string; email: string }[];
  balances: DebtBalance[];
  outstanding: { total_bdt: string; pending_debt_count: number };
  debts: Debt[];
}

export interface PlanLine {
  seq: number;
  from_user: string;
  from_name: string;
  to_user: string;
  to_name: string;
  amount_bdt: string;
  amount_display: string;
}

export interface SettlementPreview {
  total_outstanding_bdt: string;
  original_debt_count: number;
  optimized_transfer_count: number;
  transfers_saved: number;
  plan_hash: string;
  plan: PlanLine[];
  balances: DebtBalance[];
}

export interface SettlementTransfer {
  seq: number;
  from_user: string;
  from_name: string;
  to_user: string;
  to_name: string;
  amount_bdt: string;
  amount_display: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  failure_reason: string | null;
  transfer_reference: string | null;
}

export interface Settlement {
  settlement_id: string;
  reference: string;
  group_reference?: string;
  group_name?: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  total_outstanding_bdt: string;
  original_debt_count: number;
  optimized_transfer_count: number;
  success_count: number;
  failed_count: number;
  created_at: string;
  completed_at: string | null;
  transfers: SettlementTransfer[];
  resulting_balances: DebtBalance[];
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
