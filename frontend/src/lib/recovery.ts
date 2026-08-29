import type { TransferEvent, VerifyResult } from '../types';

export const EVENT_LABEL: Record<TransferEvent['event'], string> = {
  INITIATED: 'Transfer initiated',
  BALANCE_LOCKED: 'Balance verified and locked',
  PROCESSED: 'Transfer processed — funds moved',
  COMPLETED: 'Transfer completed',
  FAILED: 'Transfer failed — no money moved',
  CLIENT_CONFIRMATION_LOST: 'Client confirmation lost',
  VERIFIED: 'Transaction verified',
};

/** Dot colour per lifecycle state. */
export const STATE_DOT: Record<string, string> = {
  PENDING: 'bg-amber-400',
  PROCESSING: 'bg-amber-400',
  VERIFYING: 'bg-brand-500',
  COMPLETED: 'bg-emerald-500',
  FAILED: 'bg-rose-500',
};

export function eventDescription(e: TransferEvent): string | null {
  const d = e.detail || {};
  if (e.event === 'FAILED' && typeof d.reason === 'string') {
    return d.reason === 'INSUFFICIENT_BALANCE'
      ? 'Your available balance was less than the amount.'
      : d.reason === 'RECEIVER_NOT_FOUND'
        ? 'The recipient account could not be found.'
        : d.reason === 'RECEIVER_INACTIVE'
          ? 'The recipient account is not active.'
          : String(d.reason);
  }
  if (e.event === 'VERIFIED' && typeof d.outcome === 'string') {
    return d.outcome === 'DELIVERED'
      ? 'Confirmed against the ledger: the money was delivered.'
      : d.outcome === 'NOT_SENT'
        ? 'Confirmed against the ledger: no money left the account.'
        : 'Could not be confirmed automatically.';
  }
  if (e.event === 'CLIENT_CONFIRMATION_LOST') {
    return 'Your device did not receive the confirmation, so we checked the record.';
  }
  if (e.event === 'INITIATED' && d.attempt && Number(d.attempt) > 1) {
    return `Retry attempt #${d.attempt}.`;
  }
  return null;
}

export function outcomeBanner(
  v: VerifyResult,
  counterpartyName?: string
): { tone: 'success' | 'error'; title: string; line: string } {
  const amt = v.transfer.amount_display ?? `৳${v.transfer.amount_bdt}`;
  if (v.outcome === 'DELIVERED') {
    return {
      tone: 'success',
      title: 'Money delivered',
      line: `${amt} reached ${counterpartyName ?? 'the recipient'}. Your balance was debited once — never twice.`,
    };
  }
  if (v.outcome === 'NOT_SENT') {
    return {
      tone: 'success',
      title: 'Money safely in your account',
      line: 'No money left your account. Your balance is exactly as it was before.',
    };
  }
  return {
    tone: 'error',
    title: 'Needs manual review',
    line: `We could not confirm this automatically. Contact support with Transaction ID ${v.transfer.reference}.`,
  };
}
