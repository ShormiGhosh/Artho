/**
 * Pure transaction risk scoring. The service gathers the raw signals from the
 * database; this module turns them into a transparent score + band + decision.
 */

export interface RiskConfig {
  medium_threshold: number;
  high_threshold: number;
  large_amount_paisa: bigint;
  hard_cap_paisa: bigint;
  velocity_window_minutes: number;
  velocity_max_transfers: number;
  failed_window_minutes: number;
  failed_max_transfers: number;
  new_recipient_window_days: number;
  failed_login_window_minutes: number;
  failed_login_max: number;
}

export interface RiskSignals {
  amount_paisa: bigint;
  /** completed transfers by this sender inside the velocity window */
  recent_transfer_count: number;
  /** failed transfers by this sender inside the failed window */
  recent_failed_count: number;
  /** distinct recipients this sender has paid inside the velocity window */
  recent_distinct_recipients: number;
  /** has the sender ever completed a transfer to this recipient before? */
  sent_to_recipient_before: boolean;
  /** recipient account age in days */
  recipient_age_days: number;
  /** sender's historical average completed transfer amount (paisa), 0 if none */
  historical_avg_paisa: bigint;
  /** sender's historical max completed transfer amount (paisa), 0 if none */
  historical_max_paisa: bigint;
  historical_transfer_count: number;
  /** failed logins for this account inside the failed-login window */
  failed_login_count: number;
  /** is this (ip, user-agent) new for this user? */
  new_session: boolean;
}

export interface RiskReason {
  code: string;
  label: string;
  weight: number;
  critical: boolean;
  detail: Record<string, unknown>;
}

export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH';
export type RiskDecision = 'ALLOWED' | 'PENDING_VERIFICATION' | 'BLOCKED';

export interface RiskResult {
  score: number;
  band: RiskBand;
  decision: RiskDecision;
  reasons: RiskReason[];
}

export function scoreRisk(s: RiskSignals, c: RiskConfig): RiskResult {
  const reasons: RiskReason[] = [];
  const add = (
    code: string,
    label: string,
    weight: number,
    detail: Record<string, unknown>,
    critical = false
  ) => reasons.push({ code, label, weight, critical, detail });

  // 1. Absolute hard cap — a single decisive (critical) signal.
  if (s.amount_paisa >= c.hard_cap_paisa) {
    add(
      'AMOUNT_OVER_HARD_CAP',
      'Amount exceeds the safety cap',
      60,
      { amount_paisa: s.amount_paisa.toString(), hard_cap_paisa: c.hard_cap_paisa.toString() },
      true
    );
  } else if (s.amount_paisa >= c.large_amount_paisa) {
    add('LARGE_AMOUNT', 'Unusually large transaction', 25, {
      amount_paisa: s.amount_paisa.toString(),
      large_amount_paisa: c.large_amount_paisa.toString(),
    });
  }

  // 2. Amount far above the user's own normal activity.
  if (s.historical_transfer_count >= 3 && s.historical_max_paisa > 0n) {
    const ratio = Number(s.amount_paisa) / Number(s.historical_max_paisa);
    if (ratio >= 5) {
      add('ABNORMAL_AMOUNT_FOR_USER', 'Much larger than this user usually sends', 25, {
        ratio_to_personal_max: Number(ratio.toFixed(2)),
      });
    } else if (ratio >= 3) {
      add('ABOVE_USUAL_AMOUNT', 'Above this user’s usual amount', 12, {
        ratio_to_personal_max: Number(ratio.toFixed(2)),
      });
    }
  }

  // 3. Velocity — many transfers in a short window.
  if (s.recent_transfer_count >= c.velocity_max_transfers) {
    add('MULTIPLE_TRANSFERS', 'Multiple transfers in a short period', 20, {
      count: s.recent_transfer_count,
      window_minutes: c.velocity_window_minutes,
      limit: c.velocity_max_transfers,
    });
  }
  if (s.recent_distinct_recipients >= c.velocity_max_transfers) {
    add('MANY_RECIPIENTS', 'Paying many different people rapidly', 15, {
      distinct_recipients: s.recent_distinct_recipients,
      window_minutes: c.velocity_window_minutes,
    });
  }

  // 4. Rapid repeated failed transfers.
  if (s.recent_failed_count >= c.failed_max_transfers) {
    add('RAPID_FAILED_TRANSFERS', 'Repeated failed transfers just now', 30, {
      count: s.recent_failed_count,
      window_minutes: c.failed_window_minutes,
      limit: c.failed_max_transfers,
    });
  }

  // 5. New / newly-added recipient.
  if (!s.sent_to_recipient_before) {
    const newAccount = s.recipient_age_days <= c.new_recipient_window_days;
    const large = s.amount_paisa >= c.large_amount_paisa;
    if (newAccount && large) {
      add('NEW_RECIPIENT', 'Large transfer to a brand-new account', 25, {
        recipient_age_days: s.recipient_age_days,
        newly_registered: true,
      });
    } else if (newAccount) {
      add('NEW_RECIPIENT', 'First transfer to a brand-new account', 12, {
        recipient_age_days: s.recipient_age_days,
        newly_registered: true,
      });
    } else if (large) {
      add('NEW_RECIPIENT', 'Large transfer to a first-time recipient', 15, {
        recipient_age_days: s.recipient_age_days,
        newly_registered: false,
      });
    } else {
      add('FIRST_TIME_RECIPIENT', 'First time paying this person', 5, {
        recipient_age_days: s.recipient_age_days,
      });
    }
  }

  // 6. Recent failed logins on this account.
  if (s.failed_login_count >= c.failed_login_max) {
    add('MULTIPLE_FAILED_LOGINS', 'Multiple failed login attempts recently', 25, {
      count: s.failed_login_count,
      window_minutes: c.failed_login_window_minutes,
    });
  } else if (s.failed_login_count >= Math.ceil(c.failed_login_max / 2)) {
    add('SOME_FAILED_LOGINS', 'Some failed login attempts recently', 10, {
      count: s.failed_login_count,
    });
  }

  // 7. New device / session — a weak signal on its own.
  if (s.new_session) {
    add('NEW_SESSION', 'New device or network for this account', 10, {});
  }

  const rawScore = reasons.reduce((a, r) => a + r.weight, 0);
  const score = Math.min(100, rawScore);

  let band: RiskBand;
  if (score >= c.high_threshold) band = 'HIGH';
  else if (score >= c.medium_threshold) band = 'MEDIUM';
  else band = 'LOW';

  // Never escalate to HIGH on a single non-critical (weak) signal.
  const hasCritical = reasons.some((r) => r.critical);
  if (band === 'HIGH' && !hasCritical && reasons.length < 2) {
    band = 'MEDIUM';
  }
  if (reasons.length === 0) band = 'LOW';

  const decision: RiskDecision =
    band === 'HIGH' ? 'BLOCKED' : band === 'MEDIUM' ? 'PENDING_VERIFICATION' : 'ALLOWED';

  return { score, band, decision, reasons };
}
