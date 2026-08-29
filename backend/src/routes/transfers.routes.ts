import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { idempotencyMiddleware } from '../middleware/idempotency';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimit';
import { listTransfersQuerySchema, transferSchema } from '../middleware/schemas';
import { TransferService } from '../services/transfer.service';
import { asyncHandler, ok } from '../utils/asyncHandler';

const router = Router();

router.post(
  '/',
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 30, key: (req) => `${req.userId}:transfer` }),
  validate(transferSchema),
  idempotencyMiddleware,
  asyncHandler(async (req, res) => {
    const result = await TransferService.execute({
      senderId: req.userId!,
      receiverId: req.body.receiver_id,
      amount: req.body.amount_bdt,
      note: req.body.note ?? null,
      idempotencyKey: req.idempotencyKey!,
      type: 'TRANSFER',
    });
    ok(res, result, 202);
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
