import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { historyQuerySchema } from '../middleware/schemas';
import { HistoryService } from '../services/history.service';
import { TransferService } from '../services/transfer.service';
import { asyncHandler, ok } from '../utils/asyncHandler';

const router = Router();

router.get(
  '/',
  requireAuth,
  validate(historyQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    ok(
      res,
      await HistoryService.feed(req.userId!, {
        page: q.page,
        limit: q.limit,
        kind: q.kind,
        status: q.status,
        from: q.from,
        to: q.to,
      })
    );
  })
);

router.get(
  '/ledger',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    ok(
      res,
      await HistoryService.ledger(req.userId!, {
        page: q.page ? Number(q.page) : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
      })
    );
  })
);

// Alias so `GET /transactions/:id` works like `GET /transfers/:id`.
router.get(
  '/:idOrReference',
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, await TransferService.getForUser(req.params.idOrReference, req.userId!));
  })
);

export default router;
