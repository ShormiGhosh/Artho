import { env } from './env';

/** Every new user is funded with this amount (BDT 100,000 => 10,000,000 paisa). */
export const INITIAL_BALANCE_PAISA = env.INITIAL_BALANCE_PAISA;

export const PAISA_PER_BDT = 100n;

/** Smallest transferable amount: 1 paisa. */
export const MIN_TRANSFER_PAISA = 1n;

/** Practical upper bound well within BIGINT range. */
export const MAX_TRANSFER_PAISA = 9_000_000_000_000n; // ~BDT 90 billion

/** Idempotency records live for 24h, after which a key may be reused. */
export const IDEMPOTENCY_TTL_HOURS = 24;

/** Money requests expire 30 days after creation. */
export const REQUEST_TTL_DAYS = 30;

export const MAX_NOTE_LENGTH = 500;
export const MAX_REASON_LENGTH = 200;

/**
 * Institution accounts (that run stipend / scholarship / grant programmes) open
 * with a larger balance. Backed by a matching INITIAL_FUNDING ledger entry, so
 * the system invariant (Σ wallets == Σ ledger) still holds.
 */
export const INSTITUTION_INITIAL_BALANCE_PAISA = BigInt(
  process.env.INSTITUTION_INITIAL_BALANCE_PAISA ?? '100000000000' // BDT 1,000,000,000
);

/** Bangladesh NID: 10, 13 or 17 digits. */
export const NID_REGEX = /^(\d{10}|\d{13}|\d{17})$/;

/** Shown on every stipend transaction — funds carry no cash-out fee. */
export const STIPEND_FEE_NOTE =
  'উপবৃত্তি — যেকোনো এজেন্ট থেকে বিনামূল্যে ক্যাশ আউট (no cash-out fee on stipend funds)';
