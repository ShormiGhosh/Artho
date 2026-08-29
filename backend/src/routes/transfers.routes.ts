import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { idempotencyMiddleware } from '../middleware/idempotency';
import { fraudMiddleware } from '../middleware/fraud';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimit';
import { listTransfersQuerySchema, transferSchema } from '../middleware/schemas';
import { TransferService } from '../services/transfer.service';
import { SecurityService } from '../services/security.service';
import { asyncHandler, ok } from '../utils/asyncHandler';

const router = Router();

router.post(
  '/',
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 30, key: (req) => `${req.userId}:transfer` }),
  validate(transferSchema),
  fraudMiddleware,
  idempotencyMiddleware,
  asyncHandler(async (req, res) => {
    const result = await TransferService.execute({
      senderId: req.userId!,
      receiverId: req.body.receiver_id,
      amount: req.body.amount_bdt,
      note: req.body.note ?? null,
      idempotencyKey: req.idempotencyKey!,
      type: 'TRANSFER',
      simulate: req.body.simulate ?? null,
    });
    if (req.riskAssessment) {
      void SecurityService.linkTransfer(req.riskAssessment.id, result.transfer_id);
    }
    ok(res, { ...result, risk: req.riskAssessment ?? null }, 202);
  })
);

// "What happened to my money?" — reconcile an uncertain transfer and return its
// definite final outcome plus the full timeline. Idempotent; never moves money.
router.post(
  '/:idOrReference/verify',
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 60, key: (req) => `${req.userId}:verify` }),
  asyncHandler(async (req, res) => {
    ok(res, await TransferService.verify(req.params.idOrReference, req.userId!));
  })
);

router.get(
  '/',
  requireAuth,
  validate(listTransfersQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    ok(
      res,
      await TransferService.list(req.userId!, {
        page: q.page,
        limit: q.limit,
        status: q.status,
        direction: q.direction,
      })
    );
  })
);

router.get(
  '/:idOrReference',
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, await TransferService.getForUser(req.params.idOrReference, req.userId!));
  })
);

export default router;
