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
