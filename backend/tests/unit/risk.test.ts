import { describe, expect, it } from 'vitest';
import {
  scoreRisk,
  type RiskConfig,
  type RiskSignals,
} from '../../src/utils/riskScoring';

const CONFIG: RiskConfig = {
  medium_threshold: 20,
  high_threshold: 55,
  large_amount_paisa: 5_000_000n,
  hard_cap_paisa: 50_000_000n,
  velocity_window_minutes: 10,
  velocity_max_transfers: 5,
  failed_window_minutes: 15,
  failed_max_transfers: 3,
  new_recipient_window_days: 7,
  failed_login_window_minutes: 60,
  failed_login_max: 5,
};

const base: RiskSignals = {
  amount_paisa: 100_000n, // ৳1,000
  recent_transfer_count: 0,
  recent_failed_count: 0,
  recent_distinct_recipients: 0,
  sent_to_recipient_before: true,
  recipient_age_days: 400,
  historical_avg_paisa: 120_000n,
  historical_max_paisa: 300_000n,
  historical_transfer_count: 20,
  failed_login_count: 0,
  new_session: false,
};

describe('scoreRisk', () => {
  it('a normal transfer to a known recipient is LOW / ALLOWED with no reasons', () => {
    const r = scoreRisk(base, CONFIG);
    expect(r.reasons).toHaveLength(0);
    expect(r.band).toBe('LOW');
    expect(r.decision).toBe('ALLOWED');
    expect(r.score).toBe(0);
  });

  it('a large (but under cap) amount is MEDIUM / PENDING_VERIFICATION', () => {
    const r = scoreRisk({ ...base, amount_paisa: 6_000_000n, historical_max_paisa: 6_000_000n }, CONFIG);
    expect(r.reasons.map((x) => x.code)).toContain('LARGE_AMOUNT');
    expect(r.band).toBe('MEDIUM');
    expect(r.decision).toBe('PENDING_VERIFICATION');
  });

  it('an amount over the hard cap is HIGH / BLOCKED via a single critical signal', () => {
    const r = scoreRisk({ ...base, amount_paisa: 60_000_000n }, CONFIG);
    const codes = r.reasons.map((x) => x.code);
    expect(codes).toContain('AMOUNT_OVER_HARD_CAP');
    expect(r.reasons.find((x) => x.code === 'AMOUNT_OVER_HARD_CAP')!.critical).toBe(true);
    expect(r.band).toBe('HIGH');
    expect(r.decision).toBe('BLOCKED');
  });

  it('never escalates to HIGH on a single weak signal — capped at MEDIUM', () => {
    // Config where the lone NEW_SESSION weight (10) would otherwise clear HIGH.
    const r = scoreRisk({ ...base, new_session: true }, { ...CONFIG, medium_threshold: 3, high_threshold: 6 });
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0].critical).toBe(false);
    expect(r.band).not.toBe('HIGH');
    expect(r.decision).toBe('PENDING_VERIFICATION');
  });

  it('multiple weak signals CAN combine into HIGH', () => {
    const r = scoreRisk(
      {
        ...base,
        amount_paisa: 6_000_000n, // LARGE_AMOUNT 25
        recent_failed_count: 5, // RAPID_FAILED_TRANSFERS 30
        recent_transfer_count: 6, // MULTIPLE_TRANSFERS 20
        sent_to_recipient_before: false,
        recipient_age_days: 2, // NEW_RECIPIENT 20
      },
      CONFIG
    );
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
    expect(r.score).toBeGreaterThanOrEqual(CONFIG.high_threshold);
    expect(r.band).toBe('HIGH');
    expect(r.decision).toBe('BLOCKED');
  });

  it('velocity alone (5 transfers) is MEDIUM', () => {
    const r = scoreRisk({ ...base, recent_transfer_count: 5 }, CONFIG);
    expect(r.reasons.map((x) => x.code)).toContain('MULTIPLE_TRANSFERS');
    expect(r.decision).toBe('PENDING_VERIFICATION');
  });

  it('rapid failed transfers push at least to MEDIUM', () => {
    const r = scoreRisk({ ...base, recent_failed_count: 4 }, CONFIG);
    expect(r.reasons.map((x) => x.code)).toContain('RAPID_FAILED_TRANSFERS');
    expect(['MEDIUM', 'HIGH']).toContain(r.band);
  });

  it('multiple failed logins contribute a reason', () => {
    const r = scoreRisk({ ...base, failed_login_count: 5 }, CONFIG);
    expect(r.reasons.map((x) => x.code)).toContain('MULTIPLE_FAILED_LOGINS');
  });

  it('respects configurable thresholds', () => {
    // With a permissive config, a lone weak signal stays LOW...
    const lax = { ...CONFIG, medium_threshold: 30, high_threshold: 60 };
    expect(scoreRisk({ ...base, new_session: true }, lax).band).toBe('LOW');
    // ...and a strict config raises the same signal to MEDIUM.
    const strict = { ...CONFIG, medium_threshold: 8, high_threshold: 30 };
    const r = scoreRisk({ ...base, new_session: true }, strict);
    expect(r.score).toBe(10);
    expect(r.band).toBe('MEDIUM'); // single weak signal cannot be HIGH
  });

  it('score is clamped to 100 and reasons carry transparent weights', () => {
    const r = scoreRisk(
      {
        ...base,
        amount_paisa: 60_000_000n,
        recent_failed_count: 9,
        recent_transfer_count: 9,
        recent_distinct_recipients: 9,
        failed_login_count: 9,
        new_session: true,
        sent_to_recipient_before: false,
        recipient_age_days: 1,
      },
      CONFIG
    );
    expect(r.score).toBe(100);
    for (const reason of r.reasons) {
      expect(typeof reason.weight).toBe('number');
      expect(reason.label.length).toBeGreaterThan(0);
    }
  });
});
