import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { historyQuerySchema, lookupQuerySchema } from '../middleware/schemas';
import { HistoryService } from '../services/history.service';
import { TransferService } from '../services/transfer.service';
import { RequestService } from '../services/request.service';
import { AppError } from '../utils/errors';
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

/**
 * Unified lookup by reference or UUID. Resolves a transfer (`TXN-…`) or a money
 * request (`REQ-…`); for a bare UUID it tries a transfer first, then a request.
 * Only a party to the record can see it.
 */
router.get(
  '/lookup',
  requireAuth,
  validate(lookupQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const ref = String((req.query as any).ref).trim();
    const userId = req.userId!;
    const upper = ref.toUpperCase();

    const asTransfer = async () => ({
      kind: 'TRANSFER' as const,
      data: await TransferService.getForUser(ref, userId),
    });
    const asRequest = async () => ({
      kind: 'REQUEST' as const,
      data: await RequestService.getForUser(ref, userId),
    });

    let result;
    if (upper.startsWith('TXN-')) result = await asTransfer();
    else if (upper.startsWith('REQ-')) result = await asRequest();
    else {
      try {
        result = await asTransfer();
      } catch (err) {
        if (err instanceof AppError && err.code === 'TRANSFER_NOT_FOUND') {
          result = await asRequest();
        } else {
          throw err;
        }
      }
    }
    ok(res, result);
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
