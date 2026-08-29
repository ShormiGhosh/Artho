import { Request, Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimit';
import {
  addDebtSchema,
  addExpenseSchema,
  addMemberSchema,
  createDebtGroupSchema,
  settleSchema,
} from '../middleware/schemas';
import { DebtService } from '../services/debt.service';
import { asyncHandler, ok } from '../utils/asyncHandler';
import { Errors } from '../utils/errors';

function idempotencyKey(req: Request): string {
  const key = req.header('idempotency-key');
  if (!key || key.trim().length === 0 || key.length > 255) throw Errors.missingIdempotencyKey();
  return key.trim();
}

/** /api/debt-groups */
export const debtGroupsRouter = Router();

debtGroupsRouter.post(
  '/',
  requireAuth,
  validate(createDebtGroupSchema),
  asyncHandler(async (req, res) => {
    ok(res, await DebtService.createGroup(req.userId!, req.body), 201);
  })
);

debtGroupsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, await DebtService.listGroups(req.userId!));
  })
);

debtGroupsRouter.get(
  '/:idOrReference',
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, await DebtService.getGroup(req.params.idOrReference, req.userId!));
  })
);

debtGroupsRouter.post(
  '/:idOrReference/members',
  requireAuth,
  validate(addMemberSchema),
  asyncHandler(async (req, res) => {
    ok(res, await DebtService.addMember(req.params.idOrReference, req.userId!, req.body.user_id));
  })
);

debtGroupsRouter.post(
  '/:idOrReference/debts',
  requireAuth,
  validate(addDebtSchema),
  asyncHandler(async (req, res) => {
    ok(res, await DebtService.addDebt(req.params.idOrReference, req.userId!, req.body), 201);
  })
);

debtGroupsRouter.post(
  '/:idOrReference/expenses',
  requireAuth,
  validate(addExpenseSchema),
  asyncHandler(async (req, res) => {
    ok(res, await DebtService.addExpense(req.params.idOrReference, req.userId!, req.body), 201);
  })
);

debtGroupsRouter.get(
  '/:idOrReference/settlement-preview',
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, await DebtService.previewSettlement(req.params.idOrReference, req.userId!));
  })
);

debtGroupsRouter.post(
  '/:idOrReference/settle',
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 20, key: (req) => `${req.userId}:settle` }),
  validate(settleSchema),
  asyncHandler(async (req, res) => {
    const result = await DebtService.settle(
      req.params.idOrReference,
      req.userId!,
      idempotencyKey(req),
      req.body
    );
    ok(res, result, 202);
  })
);

debtGroupsRouter.get(
  '/:idOrReference/settlements',
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, await DebtService.listSettlements(req.params.idOrReference, req.userId!));
  })
);

/** /api/debt-settlements */
export const debtSettlementsRouter = Router();

debtSettlementsRouter.get(
  '/:idOrReference',
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, await DebtService.getSettlement(req.params.idOrReference, req.userId!));
  })
);
