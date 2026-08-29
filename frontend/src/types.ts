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

export interface Me {
  user_id: string;
  email: string;
  full_name: string;
  account_status: string;
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
  amount_bdt: string;
  amount_display: string;
  reason: string | null;
  counterparty_name?: string;
  requester_name?: string;
  requestee_name?: string;
  related_transfer_id: string | null;
  created_at: string;
  expires_at: string;
}

export interface HistoryItem {
  kind: 'TRANSFER' | 'REQUEST';
  id: string;
  reference: string;
  direction: 'SENT' | 'RECEIVED';
  badge: string;
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
