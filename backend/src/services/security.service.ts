import { pool } from '../config/database';
import { AppError, Errors } from '../utils/errors';
import { formatBdt, paisaToBdtString } from '../utils/money';
import { newRiskReference } from '../utils/reference';
import { randomToken } from '../utils/crypto';
import { logger } from '../utils/logger';
import {
  scoreRisk,
  type RiskConfig,
  type RiskReason,
  type RiskSignals,
} from '../utils/riskScoring';
import { NotificationService } from './notification.service';
import { AIService, type FraudAnalyzeInput } from './ai/aiService';
import { logAiRequest } from './ai/insightCache';

type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';

interface EventInput {
  userId?: string | null;
  type: string;
  severity?: Severity;
  ipHash?: string | null;
  uaHash?: string | null;
  transferReference?: string | null;
  detail?: Record<string, unknown>;
}

interface AssessmentRow {
  id: string;
  reference: string;
  user_id: string;
  idempotency_key: string;
  receiver_id: string | null;
  amount_paisa: bigint;
  score: number;
  band: string;
  decision: string;
  reasons: RiskReason[];
  verification_token: string | null;
  transfer_id: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
  created_at: Date;
  updated_at: Date;
}

function shapeAssessment(r: AssessmentRow) {
  return {
    assessment_id: r.id,
    reference: r.reference,
    user_id: r.user_id,
    receiver_id: r.receiver_id,
    amount_bdt: paisaToBdtString(r.amount_paisa),
    amount_display: formatBdt(r.amount_paisa),
    score: r.score,
    band: r.band,
    decision: r.decision,
    reasons: r.reasons,
    verification_token: r.decision === 'PENDING_VERIFICATION' ? r.verification_token : undefined,
    transfer_id: r.transfer_id,
    reviewed_by: r.reviewed_by,
    reviewed_at: r.reviewed_at,
    review_note: r.review_note,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export const SecurityService = {
  // ---------------- audit log ----------------

  async logEvent(e: EventInput): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO security_events
           (user_id, type, severity, ip_hash, user_agent_hash, transfer_reference, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          e.userId ?? null,
          e.type,
          e.severity ?? 'INFO',
          e.ipHash ?? null,
          e.uaHash ?? null,
          e.transferReference ?? null,
          JSON.stringify(e.detail ?? {}),
        ]
      );
    } catch (err) {
      logger.error('security event write failed', err, { type: e.type });
    }
  },

  // ---------------- config ----------------

  async getConfig(): Promise<RiskConfig> {
    const { rows } = await pool.query(`SELECT * FROM risk_config WHERE id = 1`);
    const c = rows[0];
    return {
      medium_threshold: c.medium_threshold,
      high_threshold: c.high_threshold,
      large_amount_paisa: BigInt(c.large_amount_paisa),
      hard_cap_paisa: BigInt(c.hard_cap_paisa),
      velocity_window_minutes: c.velocity_window_minutes,
      velocity_max_transfers: c.velocity_max_transfers,
      failed_window_minutes: c.failed_window_minutes,
      failed_max_transfers: c.failed_max_transfers,
      new_recipient_window_days: c.new_recipient_window_days,
      failed_login_window_minutes: c.failed_login_window_minutes,
      failed_login_max: c.failed_login_max,
    };
  },

  async getConfigRaw() {
    const { rows } = await pool.query(`SELECT * FROM risk_config WHERE id = 1`);
    const c = rows[0];
    return {
      ...c,
      large_amount_paisa: String(c.large_amount_paisa),
      hard_cap_paisa: String(c.hard_cap_paisa),
      large_amount_bdt: paisaToBdtString(c.large_amount_paisa),
      hard_cap_bdt: paisaToBdtString(c.hard_cap_paisa),
    };
  },

  async updateConfig(adminId: string, patch: Record<string, number | string>) {
    const allowed = [
      'medium_threshold',
      'high_threshold',
      'large_amount_paisa',
      'hard_cap_paisa',
      'velocity_window_minutes',
      'velocity_max_transfers',
      'failed_window_minutes',
      'failed_max_transfers',
      'new_recipient_window_days',
      'failed_login_window_minutes',
      'failed_login_max',
    ];
    const sets: string[] = [];
    const params: any[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!allowed.includes(k)) continue;
      if (v === undefined || v === null) continue;
      const num = BigInt(String(v));
      if (num < 0n) throw Errors.invalidRequest(`${k} must be non-negative`);
      params.push(num.toString());
      sets.push(`${k} = $${params.length}`);
    }
    if (sets.length === 0) return this.getConfigRaw();
    params.push(adminId);
    await pool.query(
      `UPDATE risk_config SET ${sets.join(', ')}, updated_at = NOW(), updated_by = $${params.length} WHERE id = 1`,
      params
    );
    await this.logEvent({
      userId: adminId,
      type: 'RISK_CONFIG_CHANGED',
      severity: 'INFO',
      detail: { patch },
    });
    return this.getConfigRaw();
  },

  // ---------------- login security ----------------

  async loginLockState(userId: string): Promise<{ locked: boolean; retry_after_s: number }> {
    const cfg = await this.getConfig();
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c, MIN(created_at) AS earliest
         FROM security_events
        WHERE user_id = $1 AND type = 'LOGIN_FAILED'
          AND created_at > NOW() - ($2 || ' minutes')::interval`,
      [userId, cfg.failed_login_window_minutes]
    );
    const c = rows[0].c as number;
    if (c < cfg.failed_login_max) return { locked: false, retry_after_s: 0 };
    const earliest = new Date(rows[0].earliest).getTime();
    const unlockAt = earliest + cfg.failed_login_window_minutes * 60_000;
    return { locked: true, retry_after_s: Math.max(1, Math.ceil((unlockAt - Date.now()) / 1000)) };
  },

  async failedLoginCount(userId: string): Promise<number> {
    const cfg = await this.getConfig();
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM security_events
        WHERE user_id = $1 AND type = 'LOGIN_FAILED'
          AND created_at > NOW() - ($2 || ' minutes')::interval`,
      [userId, cfg.failed_login_window_minutes]
    );
    return rows[0].c;
  },

  async recordLoginOutcome(input: {
    userId: string | null;
    email: string;
    success: boolean;
    ipHash: string | null;
    uaHash: string | null;
  }): Promise<void> {
    await this.logEvent({
      userId: input.userId,
      type: input.success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED',
      severity: input.success ? 'INFO' : 'LOW',
      ipHash: input.ipHash,
      uaHash: input.uaHash,
      detail: { email_domain: input.email.split('@')[1] ?? null },
    });
    if (input.success && input.userId && input.ipHash && input.uaHash) {
      const isNew = await this.touchSession(input.userId, input.ipHash, input.uaHash);
      if (isNew) {
        await this.logEvent({
          userId: input.userId,
          type: 'LOGIN_NEW_DEVICE',
          severity: 'LOW',
          ipHash: input.ipHash,
          uaHash: input.uaHash,
        });
      }
    }
  },

  /** Upsert a (user, ip, ua) session; returns true if it had never been seen. */
  async touchSession(userId: string, ipHash: string, uaHash: string): Promise<boolean> {
    const { rows } = await pool.query(
      `INSERT INTO known_sessions (user_id, ip_hash, user_agent_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, ip_hash, user_agent_hash)
       DO UPDATE SET last_seen_at = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [userId, ipHash, uaHash]
    );
    return !!rows[0]?.inserted;
  },

  // ---------------- transaction risk ----------------

  async getAssessmentByKey(userId: string, idempotencyKey: string): Promise<AssessmentRow | null> {
    const { rows } = await pool.query<AssessmentRow>(
      `SELECT * FROM transfer_risk_assessments WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey]
    );
    return rows[0] ?? null;
  },

  async gatherSignals(userId: string, receiverId: string, amountPaisa: bigint, ctx: {
    ipHash: string | null;
    uaHash: string | null;
  }) {
    const cfg = await this.getConfig();
    const [vel, fail, dist, before, recip, hist, failedLogins, sess] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS c FROM transfers
          WHERE sender_id = $1 AND status = 'COMPLETED'
            AND created_at > NOW() - ($2 || ' minutes')::interval`,
        [userId, cfg.velocity_window_minutes]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM transfers
          WHERE sender_id = $1 AND status = 'FAILED'
            AND created_at > NOW() - ($2 || ' minutes')::interval`,
        [userId, cfg.failed_window_minutes]
      ),
      pool.query(
        `SELECT COUNT(DISTINCT receiver_id)::int AS c FROM transfers
          WHERE sender_id = $1 AND status IN ('COMPLETED', 'PENDING', 'PROCESSING')
            AND created_at > NOW() - ($2 || ' minutes')::interval`,
        [userId, cfg.velocity_window_minutes]
      ),
      pool.query(
        `SELECT EXISTS(SELECT 1 FROM transfers
           WHERE sender_id = $1 AND receiver_id = $2 AND status = 'COMPLETED') AS ok`,
        [userId, receiverId]
      ),
      pool.query(
        `SELECT GREATEST(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0, 0) AS age_days,
                account_status
           FROM users WHERE id = $1`,
        [receiverId]
      ),
      pool.query(
        `SELECT COALESCE(AVG(amount_paisa), 0)::bigint AS avg_p,
                COALESCE(MAX(amount_paisa), 0)::bigint AS max_p,
                COUNT(*)::int AS c
           FROM transfers
          WHERE sender_id = $1 AND status = 'COMPLETED' AND type = 'TRANSFER'`,
        [userId]
      ),
      this.failedLoginCount(userId),
      ctx.ipHash && ctx.uaHash
        ? pool.query(
            `SELECT EXISTS(SELECT 1 FROM known_sessions
               WHERE user_id = $1 AND ip_hash = $2 AND user_agent_hash = $3) AS known`,
            [userId, ctx.ipHash, ctx.uaHash]
          )
        : Promise.resolve({ rows: [{ known: true }] } as any),
    ]);

    return {
      config: cfg,
      signals: {
        amount_paisa: amountPaisa,
        recent_transfer_count: vel.rows[0].c,
        recent_failed_count: fail.rows[0].c,
        recent_distinct_recipients: dist.rows[0].c,
        sent_to_recipient_before: before.rows[0].ok,
        recipient_age_days: Math.floor(Number(recip.rows[0]?.age_days ?? 9999)),
        historical_avg_paisa: BigInt(hist.rows[0].avg_p),
        historical_max_paisa: BigInt(hist.rows[0].max_p),
        historical_transfer_count: hist.rows[0].c,
        failed_login_count: failedLogins,
        new_session: !sess.rows[0].known,
      },
    };
  },

  /** Assess a transfer. Idempotent per (user, idempotencyKey). */
  async assess(input: {
    userId: string;
    receiverId: string;
    amountPaisa: bigint;
    idempotencyKey: string;
    ipHash: string | null;
    uaHash: string | null;
  }): Promise<AssessmentRow> {
    const existing = await this.getAssessmentByKey(input.userId, input.idempotencyKey);
    if (existing) return existing;

    const { config, signals } = await this.gatherSignals(
      input.userId,
      input.receiverId,
      input.amountPaisa,
      { ipHash: input.ipHash, uaHash: input.uaHash }
    );
    const result = scoreRisk(signals, config);
    const token = result.decision === 'PENDING_VERIFICATION' ? randomToken(24) : null;

    // Snapshot the signals so a secondary AI analysis (advisory) can be run now
    // or on demand later without re-querying. Bigints -> strings for JSONB.
    const signalSnapshot = JSON.parse(
      JSON.stringify(signals, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    );

    const ins = await pool.query<AssessmentRow>(
      `INSERT INTO transfer_risk_assessments
         (reference, user_id, idempotency_key, receiver_id, amount_paisa, score, band,
          decision, reasons, verification_token, signals)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [
        newRiskReference(),
        input.userId,
        input.idempotencyKey,
        input.receiverId,
        input.amountPaisa.toString(),
        result.score,
        result.band,
        result.decision,
        JSON.stringify(result.reasons),
        token,
        JSON.stringify(signalSnapshot),
      ]
    );

    let row = ins.rows[0] as AssessmentRow | undefined;
    if (!row) {
      row = (await this.getAssessmentByKey(input.userId, input.idempotencyKey))!;
    } else {
      await this.logEvent({
        userId: input.userId,
        type: 'RISK_ASSESSED',
        severity: result.band === 'LOW' ? 'LOW' : result.band,
        ipHash: input.ipHash,
        uaHash: input.uaHash,
        detail: {
          assessment_reference: row.reference,
          score: result.score,
          band: result.band,
          decision: result.decision,
          reasons: result.reasons.map((r) => r.code),
        },
      });

      if (result.decision === 'BLOCKED') {
        await this.logEvent({
          userId: input.userId,
          type: 'TRANSFER_BLOCKED',
          severity: 'HIGH',
          detail: { assessment_reference: row.reference, score: result.score },
        });
        NotificationService.emit({
          userId: input.userId,
          type: 'SECURITY_ALERT',
          title: 'Transfer held for review',
          message: `A ${formatBdt(input.amountPaisa)} transfer was placed on hold by our fraud checks (ref ${row.reference}). Our team has been notified.`,
        });
        logger.warn('HIGH-risk transfer blocked', {
          userId: input.userId,
          assessment: row.reference,
          score: result.score,
        });
      }

      // Secondary AI analysis — advisory only, runs out-of-band so it never
      // delays or gates the transfer. The deterministic decision above stands
      // regardless of whether (or what) the AI returns.
      const assessmentId = row.id;
      setImmediate(() => {
        void SecurityService.runAiAnalysis(assessmentId).catch((e) =>
          logger.error('ai fraud analysis failed', e, { assessmentId })
        );
      });
    }
    return row;
  },

  /**
   * Run (or refresh) the advisory AI fraud analysis for one assessment and store
   * it on the row. Pure add-on: it cannot change the score, band, decision, or
   * anything about the transfer. Safe to call repeatedly.
   */
  async runAiAnalysis(assessmentId: string): Promise<Record<string, unknown> | null> {
    const { rows } = await pool.query<AssessmentRow & { signals: any }>(
      `SELECT * FROM transfer_risk_assessments WHERE id = $1`,
      [assessmentId]
    );
    const a = rows[0];
    if (!a) return null;

    const s = (a.signals ?? {}) as Partial<Record<keyof RiskSignals, unknown>>;
    const num = (v: unknown) => (v == null ? 0 : Number(v));
    const input: FraudAnalyzeInput = {
      reference: a.reference,
      signals: {
        transaction_amount_bdt: paisaToBdtString(a.amount_paisa),
        recent_transaction_count: num(s.recent_transfer_count),
        recipient_is_new: !s.sent_to_recipient_before,
        device_is_new: !!s.new_session,
        failed_auth_attempts: num(s.failed_login_count),
        transaction_frequency_window_minutes: 0,
        user_transaction_baseline_bdt: paisaToBdtString(String(s.historical_avg_paisa ?? '0')),
        existing_risk_score: a.score,
      },
      rule_based: {
        band: a.band,
        decision: a.decision,
        score: a.score,
        reasons: Array.isArray(a.reasons)
          ? a.reasons.map((r) => String((r as RiskReason).label ?? (r as RiskReason).code ?? '')).filter(Boolean)
          : [],
      },
    };

    const { result, meta } = await AIService.analyzeFraud(input);
    const stored = {
      risk_level: result.risk_level,
      reasoning_summary: result.reasoning_summary,
      risk_factors: result.risk_factors,
      recommended_action: result.recommended_action,
      source: result.source,
      model: result.model,
      note: 'Advisory only. The deterministic rule-based assessment is authoritative.',
      analyzed_at: new Date().toISOString(),
    };
    await pool.query(
      `UPDATE transfer_risk_assessments
          SET ai_analysis = $2::jsonb, ai_analyzed_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [assessmentId, JSON.stringify(stored)]
    );
    await logAiRequest({
      feature: 'ai_fraud',
      userId: a.user_id,
      model: meta.model,
      outcome: meta.outcome,
      errorCode: meta.errorCode,
      durationMs: meta.durationMs,
      promptTokens: meta.promptTokens,
      completionTokens: meta.completionTokens,
    });
    return stored;
  },

  async markVerified(userId: string, idempotencyKey: string, token: string): Promise<AssessmentRow> {
    const row = await this.getAssessmentByKey(userId, idempotencyKey);
    if (!row) throw Errors.internal('Risk assessment missing');
    if (row.decision === 'VERIFIED' || row.decision === 'ALLOWED' || row.decision === 'RELEASED') {
      return row;
    }
    if (row.decision !== 'PENDING_VERIFICATION') {
      throw new AppError('RISK_NOT_PENDING', 'This transfer is not awaiting verification', 409);
    }
    if (!row.verification_token || token !== row.verification_token) {
      throw new AppError('RISK_VERIFICATION_INVALID', 'Invalid verification token', 400);
    }
    const upd = await pool.query<AssessmentRow>(
      `UPDATE transfer_risk_assessments
          SET decision = 'VERIFIED', updated_at = NOW()
        WHERE id = $1 AND decision = 'PENDING_VERIFICATION'
        RETURNING *`,
      [row.id]
    );
    await this.logEvent({
      userId,
      type: 'VERIFICATION_PASSED',
      severity: 'INFO',
      detail: { assessment_reference: row.reference },
    });
    return upd.rows[0] ?? row;
  },

  async linkTransfer(assessmentId: string, transferId: string): Promise<void> {
    await pool
      .query(`UPDATE transfer_risk_assessments SET transfer_id = $2, updated_at = NOW() WHERE id = $1`, [
        assessmentId,
        transferId,
      ])
      .catch((e) => logger.error('linkTransfer failed', e));
  },

  // ---------------- admin review ----------------

  async release(assessmentId: string, adminId: string, note: string | null) {
    const { rows } = await pool.query<AssessmentRow>(
      `SELECT * FROM transfer_risk_assessments WHERE id = $1`,
      [assessmentId]
    );
    const a = rows[0];
    if (!a) throw new AppError('ASSESSMENT_NOT_FOUND', 'Assessment not found', 404);
    if (a.decision !== 'BLOCKED') {
      throw new AppError('ASSESSMENT_NOT_BLOCKED', 'Only a blocked transfer can be released', 409);
    }
    await pool.query(
      `UPDATE transfer_risk_assessments
          SET decision = 'RELEASED', reviewed_by = $2, reviewed_at = NOW(), review_note = $3, updated_at = NOW()
        WHERE id = $1`,
      [assessmentId, adminId, note]
    );
    await this.logEvent({
      userId: a.user_id,
      type: 'TRANSFER_RELEASED',
      severity: 'MEDIUM',
      detail: { assessment_reference: a.reference, reviewed_by: adminId, note },
    });
    NotificationService.emit({
      userId: a.user_id,
      type: 'SECURITY_ALERT',
      title: 'Transfer hold released',
      message: `Your ${formatBdt(a.amount_paisa)} transfer (ref ${a.reference}) has been reviewed and released. You can retry it now.`,
    });
    return shapeAssessment({ ...a, decision: 'RELEASED', review_note: note });
  },

  async reject(assessmentId: string, adminId: string, note: string | null) {
    const { rows } = await pool.query<AssessmentRow>(
      `SELECT * FROM transfer_risk_assessments WHERE id = $1`,
      [assessmentId]
    );
    const a = rows[0];
    if (!a) throw new AppError('ASSESSMENT_NOT_FOUND', 'Assessment not found', 404);
    await pool.query(
      `UPDATE transfer_risk_assessments
          SET reviewed_by = $2, reviewed_at = NOW(), review_note = $3, updated_at = NOW()
        WHERE id = $1`,
      [assessmentId, adminId, note]
    );
    await this.logEvent({
      userId: a.user_id,
      type: 'TRANSFER_REVIEW_REJECTED',
      severity: 'MEDIUM',
      detail: { assessment_reference: a.reference, reviewed_by: adminId, note },
    });
    return shapeAssessment({ ...a, review_note: note });
  },

  async dashboard() {
    const [bands, decisions, recent, events24, blocked] = await Promise.all([
      pool.query(
        `SELECT band, COUNT(*)::int AS c FROM transfer_risk_assessments
          WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY band`
      ),
      pool.query(
        `SELECT decision, COUNT(*)::int AS c FROM transfer_risk_assessments GROUP BY decision`
      ),
      pool.query(
        `SELECT a.*, u.full_name AS user_name, r.full_name AS receiver_name,
                t.reference AS transfer_reference
           FROM transfer_risk_assessments a
           JOIN users u ON u.id = a.user_id
           LEFT JOIN users r ON r.id = a.receiver_id
           LEFT JOIN transfers t ON t.id = a.transfer_id
          WHERE a.band <> 'LOW' OR a.decision IN ('BLOCKED', 'PENDING_VERIFICATION', 'RELEASED')
          ORDER BY a.created_at DESC
          LIMIT 25`
      ),
      pool.query(
        `SELECT severity, COUNT(*)::int AS c FROM security_events
          WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY severity`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM transfer_risk_assessments WHERE decision = 'BLOCKED'`
      ),
    ]);

    const bandMap: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
    for (const b of bands.rows) bandMap[b.band] = b.c;
    const decisionMap: Record<string, number> = {};
    for (const d of decisions.rows) decisionMap[d.decision] = d.c;
    const sevMap: Record<string, number> = {};
    for (const e of events24.rows) sevMap[e.severity] = e.c;

    return {
      last_24h_by_band: bandMap,
      by_decision: decisionMap,
      currently_blocked: blocked.rows[0].c,
      last_24h_events_by_severity: sevMap,
      flagged: recent.rows.map((a) => ({
        ...shapeAssessment(a),
        user_name: a.user_name,
        receiver_name: a.receiver_name,
        transfer_reference: a.transfer_reference,
      })),
    };
  },

  async listAssessments(opts: { band?: string; decision?: string; page?: number }) {
    const page = Math.max(opts.page ?? 1, 1);
    const limit = 25;
    const filters: string[] = ['1 = 1'];
    const params: any[] = [];
    if (opts.band && opts.band !== 'all') {
      params.push(opts.band);
      filters.push(`a.band = $${params.length}`);
    }
    if (opts.decision && opts.decision !== 'all') {
      params.push(opts.decision);
      filters.push(`a.decision = $${params.length}`);
    }
    const where = filters.join(' AND ');
    const total = await pool.query(
      `SELECT COUNT(*)::int AS c FROM transfer_risk_assessments a WHERE ${where}`,
      params
    );
    params.push(limit, (page - 1) * limit);
    const { rows } = await pool.query(
      `SELECT a.*, u.full_name AS user_name, r.full_name AS receiver_name,
              t.reference AS transfer_reference
         FROM transfer_risk_assessments a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN users r ON r.id = a.receiver_id
         LEFT JOIN transfers t ON t.id = a.transfer_id
        WHERE ${where}
        ORDER BY a.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return {
      assessments: rows.map((a) => ({
        ...shapeAssessment(a),
        user_name: a.user_name,
        receiver_name: a.receiver_name,
        transfer_reference: a.transfer_reference,
      })),
      pagination: { page, limit, total: total.rows[0].c, pages: Math.ceil(total.rows[0].c / limit) || 1 },
    };
  },

  async getAssessment(idOrReference: string) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrReference);
    const { rows } = await pool.query(
      `SELECT a.*, u.full_name AS user_name, u.email AS user_email,
              r.full_name AS receiver_name, t.reference AS transfer_reference
         FROM transfer_risk_assessments a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN users r ON r.id = a.receiver_id
         LEFT JOIN transfers t ON t.id = a.transfer_id
        WHERE a.${isUuid ? 'id' : 'reference'} = $1`,
      [isUuid ? idOrReference : idOrReference.toUpperCase()]
    );
    if (rows.length === 0) throw new AppError('ASSESSMENT_NOT_FOUND', 'Assessment not found', 404);
    const a = rows[0];
    const events = await pool.query(
      `SELECT id, type, severity, transfer_reference, detail, created_at
         FROM security_events
        WHERE user_id = $1
          AND created_at BETWEEN $2::timestamptz - INTERVAL '1 hour'
                             AND $2::timestamptz + INTERVAL '1 hour'
        ORDER BY created_at DESC
        LIMIT 50`,
      [a.user_id, a.created_at]
    );
    return {
      ...shapeAssessment(a),
      user_name: a.user_name,
      user_email: a.user_email,
      receiver_name: a.receiver_name,
      transfer_reference: a.transfer_reference,
      related_events: events.rows,
      ai_analysis: a.ai_analysis ?? null,
      ai_analyzed_at: a.ai_analyzed_at ?? null,
      ai_available: AIService.enabled,
    };
  },

  async listEvents(opts: { type?: string; severity?: string; page?: number }) {
    const page = Math.max(opts.page ?? 1, 1);
    const limit = 50;
    const filters: string[] = ['1 = 1'];
    const params: any[] = [];
    if (opts.type && opts.type !== 'all') {
      params.push(opts.type);
      filters.push(`e.type = $${params.length}`);
    }
    if (opts.severity && opts.severity !== 'all') {
      params.push(opts.severity);
      filters.push(`e.severity = $${params.length}`);
    }
    const where = filters.join(' AND ');
    const total = await pool.query(
      `SELECT COUNT(*)::int AS c FROM security_events e WHERE ${where}`,
      params
    );
    params.push(limit, (page - 1) * limit);
    const { rows } = await pool.query(
      `SELECT e.id, e.type, e.severity, e.transfer_reference, e.detail, e.created_at,
              u.full_name AS user_name
         FROM security_events e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE ${where}
        ORDER BY e.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return {
      events: rows,
      pagination: { page, limit, total: total.rows[0].c, pages: Math.ceil(total.rows[0].c / limit) || 1 },
    };
  },
};
