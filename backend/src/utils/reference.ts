import crypto from 'crypto';

function today(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function randomChunk(len: number): string {
  return crypto
    .randomBytes(len)
    .toString('hex')
    .slice(0, len)
    .toUpperCase();
}

/** Human-friendly, copyable transfer reference: TXN-20260829-9F3A1C7B */
export function newTransferReference(): string {
  return `TXN-${today()}-${randomChunk(8)}`;
}

/** Human-friendly money-request reference: REQ-20260829-9F3A1C7B */
export function newRequestReference(): string {
  return `REQ-${today()}-${randomChunk(8)}`;
}

/** Stipend / scholarship / grant programme reference: PRG-20260829-9F3A1C7B */
export function newStipendProgramReference(): string {
  return `PRG-${today()}-${randomChunk(8)}`;
}

/** Disbursement (payout run) reference: DSB-20260829-9F3A1C7B */
export function newDisbursementReference(): string {
  return `DSB-${today()}-${randomChunk(8)}`;
}

/** Debt group reference: GRP-20260829-9F3A1C7B */
export function newDebtGroupReference(): string {
  return `GRP-${today()}-${randomChunk(8)}`;
}

/** Debt / expense-share reference: DEBT-20260829-9F3A1C7B */
export function newDebtReference(): string {
  return `DEBT-${today()}-${randomChunk(8)}`;
}

/** Settlement run reference: STL-20260829-9F3A1C7B */
export function newSettlementReference(): string {
  return `STL-${today()}-${randomChunk(8)}`;
}

/** Risk assessment reference: RISK-20260829-9F3A1C7B */
export function newRiskReference(): string {
  return `RISK-${today()}-${randomChunk(8)}`;
}

/** Server-side idempotency key for internally-triggered transfers. */
export function newInternalIdempotencyKey(prefix: string): string {
  return `req-${prefix}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}
