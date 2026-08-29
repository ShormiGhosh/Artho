import { pool } from '../config/database';
import { paisaToBdtString } from '../utils/money';
import { logger } from '../utils/logger';

export interface InvariantReport {
  [key: string]: unknown;
  healthy: boolean;
  wallet_total_paisa: string;
  ledger_total_paisa: string;
  drift_paisa: string;
  negative_wallets: number;
  checked_at: string;
}

/**
 * System invariant: the sum of every wallet balance must equal the sum of every
 * immutable ledger entry. Any drift means money was created or destroyed.
 */
export async function checkInvariants(): Promise<InvariantReport> {
  const [{ rows: w }, { rows: l }, { rows: neg }] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(balance_paisa), 0)::text AS total FROM wallets`),
    pool.query(`SELECT COALESCE(SUM(amount_paisa), 0)::text AS total FROM ledger_entries`),
    pool.query(`SELECT COUNT(*)::int AS c FROM wallets WHERE balance_paisa < 0`),
  ]);

  const walletTotal = BigInt(w[0].total);
  const ledgerTotal = BigInt(l[0].total);
  const drift = walletTotal - ledgerTotal;
  const negativeWallets = neg[0].c as number;
  const healthy = drift === 0n && negativeWallets === 0;

  const report: InvariantReport = {
    healthy,
    wallet_total_paisa: walletTotal.toString(),
    ledger_total_paisa: ledgerTotal.toString(),
    drift_paisa: drift.toString(),
    negative_wallets: negativeWallets,
    checked_at: new Date().toISOString(),
  };

  if (!healthy) {
    logger.error('INVARIANT VIOLATION', undefined, {
      ...report,
      wallet_total_bdt: paisaToBdtString(walletTotal),
      ledger_total_bdt: paisaToBdtString(ledgerTotal),
    });
  } else {
    logger.info('invariant check ok', {
      wallet_total_bdt: paisaToBdtString(walletTotal),
    });
  }
  return report;
}
