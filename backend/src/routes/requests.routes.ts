import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { idempotencyMiddleware } from '../middleware/idempotency';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimit';
import { moneyRequestSchema, requestListQuerySchema } from '../middleware/schemas';
import { RequestService } from '../services/request.service';
import { asyncHandler, ok } from '../utils/asyncHandler';

const router = Router();

router.post(
  '/',
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 30, key: (req) => `${req.userId}:request` }),
  validate(moneyRequestSchema),
  asyncHandler(async (req, res) => {
    const result = await RequestService.create({
      requesterId: req.userId!,
      requesteeId: req.body.requestee_id,
      amount: req.body.amount_bdt,
      reason: req.body.reason ?? null,
    });
    ok(res, result, 201);
  })
);

router.get(
  '/',
  requireAuth,
  validate(requestListQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    ok(res, await RequestService.list(req.userId!, { direction: q.direction, status: q.status }));
  })
);

router.post(
  '/:idOrReference/approve',
  requireAuth,
  idempotencyMiddleware,
  asyncHandler(async (req, res) => {
    ok(res, await RequestService.approve(req.params.idOrReference, req.userId!), 200);
  })
);

router.post(
  '/:idOrReference/reject',
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, await RequestService.reject(req.params.idOrReference, req.userId!));
  })
);

router.delete(
  '/:idOrReference',
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, await RequestService.cancel(req.params.idOrReference, req.userId!));
  })
);

export default router;
