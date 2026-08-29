import { NextFunction, Request, Response } from 'express';
import { Errors } from '../utils/errors';
import { bdtToPaisa, MoneyError } from '../utils/money';
import { SecurityService } from '../services/security.service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      riskAssessment?: { id: string; reference: string; band: string; decision: string };
    }
  }
}

function verificationRequired(req: Request, res: Response, a: any): void {
  res.status(200).json({
    success: true,
    data: {
      status: 'VERIFICATION_REQUIRED',
      assessment_reference: a.reference,
      score: a.score,
      band: a.band,
      reasons: a.reasons,
      verification_token: a.verification_token,
      message:
        'This transfer needs an extra confirmation. Review the reasons and re-submit with the verification token to proceed.',
    },
    request_id: req.requestId,
  });
}

function blocked(req: Request, res: Response, a: any): void {
  res.status(403).json({
    success: false,
    error: {
      code: 'TRANSFER_BLOCKED_RISK',
      message:
        'This transfer has been placed on hold by our fraud checks. You and our security team have been notified.',
      details: {
        assessment_reference: a.reference,
        score: a.score,
        band: a.band,
        reasons: a.reasons,
      },
    },
    request_id: req.requestId,
  });
}

/**
 * Fraud / risk gate for `POST /transfers`. Runs AFTER auth+validation and
 * BEFORE the idempotency middleware, so:
 *  - a genuine retry of an already-decided key re-uses the same assessment
 *    (no re-scoring, no bypass);
 *  - a MEDIUM transfer returns VERIFICATION_REQUIRED without creating a transfer;
 *    the client re-submits the SAME idempotency key + `risk_ack` to proceed;
 *  - a HIGH transfer is blocked until an admin releases it.
 * The assessment table is keyed by (user, idempotencyKey) so it is itself
 * exactly-once and safe under concurrent duplicate requests.
 */
export async function fraudMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const key = req.header('idempotency-key');
    if (!key || key.trim().length === 0) return next(Errors.missingIdempotencyKey());
    const userId = req.userId!;
    const receiverId = req.body?.receiver_id as string;

    // Structural problems are the transfer engine's job to reject; skip risk.
    if (!receiverId || receiverId === userId) return next();

    let amountPaisa: bigint;
    try {
      amountPaisa = bdtToPaisa(req.body.amount_bdt);
    } catch (e) {
      if (e instanceof MoneyError) return next();
      throw e;
    }

    const ack = (req.body?.risk_ack as string) || (req.header('x-risk-ack') as string) || null;
    const attach = (a: any) => {
      req.riskAssessment = { id: a.id, reference: a.reference, band: a.band, decision: a.decision };
      next();
    };

    const existing = await SecurityService.getAssessmentByKey(userId, key.trim());
    if (existing) {
      if (['ALLOWED', 'VERIFIED', 'RELEASED'].includes(existing.decision)) return attach(existing);
      if (existing.decision === 'BLOCKED') return blocked(req, res, existing);
      // PENDING_VERIFICATION
      if (ack && ack === existing.verification_token) {
        return attach(await SecurityService.markVerified(userId, key.trim(), ack));
      }
      return verificationRequired(req, res, existing);
    }

    const a = await SecurityService.assess({
      userId,
      receiverId,
      amountPaisa,
      idempotencyKey: key.trim(),
      ipHash: req.ipHash,
      uaHash: req.uaHash,
    });

    if (a.decision === 'ALLOWED') return attach(a);
    if (a.decision === 'BLOCKED') return blocked(req, res, a);
    if (ack && ack === a.verification_token) {
      return attach(await SecurityService.markVerified(userId, key.trim(), ack));
    }
    return verificationRequired(req, res, a);
  } catch (err) {
    next(err);
  }
}
