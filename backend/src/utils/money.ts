import { MAX_TRANSFER_PAISA, MIN_TRANSFER_PAISA, PAISA_PER_BDT } from '../config/constants';

/**
 * All money is stored and moved as BIGINT paisa. Floating point never touches
 * a balance. User-facing amounts arrive as decimal BDT strings/numbers and are
 * converted here with strict validation.
 */

export class MoneyError extends Error {}

/**
 * Parse a user-supplied BDT amount ("2500", "2500.50", 2500) into paisa.
 * Rejects: non-numeric, <= 0, more than 2 decimal places, out of bounds.
 */
export function bdtToPaisa(input: string | number): bigint {
  const raw = typeof input === 'number' ? input.toString() : input.trim();

  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new MoneyError('Amount must be a positive number with at most 2 decimal places');
  }

  const [whole, frac = ''] = raw.split('.');
  const fracPadded = (frac + '00').slice(0, 2);
  const paisa = BigInt(whole) * PAISA_PER_BDT + BigInt(fracPadded);

  if (paisa < MIN_TRANSFER_PAISA) {
    throw new MoneyError('Amount must be greater than zero');
  }
  if (paisa > MAX_TRANSFER_PAISA) {
    throw new MoneyError('Amount exceeds the maximum allowed');
  }
  return paisa;
}

/** paisa (bigint | string | number) -> "2500.50" */
export function paisaToBdtString(paisa: bigint | string | number): string {
  const p = typeof paisa === 'bigint' ? paisa : BigInt(paisa);
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const whole = abs / PAISA_PER_BDT;
  const frac = abs % PAISA_PER_BDT;
  return `${neg ? '-' : ''}${whole.toString()}.${frac.toString().padStart(2, '0')}`;
}

/** paisa -> "৳2,500.50" for display / notifications. */
export function formatBdt(paisa: bigint | string | number): string {
  const s = paisaToBdtString(paisa);
  const [whole, frac] = s.replace('-', '').split('.');
  const withSep = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${s.startsWith('-') ? '-' : ''}৳${withSep}.${frac}`;
}

export function isValidAmountString(input: unknown): boolean {
  try {
    bdtToPaisa(input as string);
    return true;
  } catch {
    return false;
  }
}
