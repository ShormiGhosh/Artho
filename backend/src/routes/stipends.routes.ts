import { Request, Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  bulkDisburseSchema,
  createProgramSchema,
  disburseSchema,
  enrollBeneficiarySchema,
  updateBeneficiarySchema,
} from '../middleware/schemas';
import { AuthService } from '../services/auth.service';
import { StipendService } from '../services/stipend.service';
import { asyncHandler, ok } from '../utils/asyncHandler';
import { Errors } from '../utils/errors';

/** Disbursement idempotency key is supplied by the client and stored on the batch. */
function idempotencyKey(req: Request): string {
  const key = req.header('idempotency-key');
  if (!key || key.trim().length === 0 || key.length > 255) {
    throw Errors.missingIdempotencyKey();
  }
  return key.trim();
}

/** /api/stipend-programs */
export const programsRouter = Router();

programsRouter.post(
  '/',
  requireAuth,
  requireRole('INSTITUTION'),
  validate(createProgramSchema),
  asyncHandler(async (req, res) => {
    ok(res, await StipendService.createProgram(req.userId!, req.body), 201);
  })
);

programsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = await AuthService.profile(req.userId!);
    ok(res, await StipendService.listPrograms(req.userId!, me.role));
  })
);

programsRouter.get(
  '/:idOrReference',
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = await AuthService.profile(req.userId!);
    ok(res, await StipendService.getProgram(req.params.idOrReference, req.userId!, me.role));
  })
);

programsRouter.post(
  '/:idOrReference/close',
  requireAuth,
  requireRole('INSTITUTION'),
  asyncHandler(async (req, res) => {
    ok(res, await StipendService.closeProgram(req.params.idOrReference, req.userId!));
  })
);

programsRouter.get(
  '/:idOrReference/beneficiaries',
  requireAuth,
  requireRole('INSTITUTION'),
  asyncHandler(async (req, res) => {
    ok(res, await StipendService.listBeneficiaries(req.params.idOrReference, req.userId!));
  })
);

programsRouter.post(
  '/:idOrReference/beneficiaries',
  requireAuth,
  requireRole('INSTITUTION'),
  validate(enrollBeneficiarySchema),
  asyncHandler(async (req, res) => {
    ok(res, await StipendService.enroll(req.params.idOrReference, req.userId!, req.body), 201);
  })
);

programsRouter.patch(
  '/:idOrReference/beneficiaries/:beneficiaryId',
  requireAuth,
  requireRole('INSTITUTION'),
  validate(updateBeneficiarySchema),
  asyncHandler(async (req, res) => {
    ok(
      res,
      await StipendService.updateBeneficiary(
        req.params.idOrReference,
        req.params.beneficiaryId,
        req.userId!,
        req.body
      )
    );
  })
);

programsRouter.delete(
  '/:idOrReference/beneficiaries/:beneficiaryId',
  requireAuth,
  requireRole('INSTITUTION'),
  asyncHandler(async (req, res) => {
    ok(
      res,
      await StipendService.removeBeneficiary(
        req.params.idOrReference,
        req.params.beneficiaryId,
        req.userId!
      )
    );
  })
);

programsRouter.post(
  '/:idOrReference/disburse',
  requireAuth,
  requireRole('INSTITUTION'),
  validate(disburseSchema),
  asyncHandler(async (req, res) => {
    ok(
      res,
      await StipendService.disburse(
        req.params.idOrReference,
        req.userId!,
        idempotencyKey(req),
        req.body
      ),
      201
    );
  })
);

programsRouter.post(
  '/:idOrReference/bulk-disburse',
  requireAuth,
  requireRole('INSTITUTION'),
  validate(bulkDisburseSchema),
  asyncHandler(async (req, res) => {
    const key = req.body.dry_run ? null : idempotencyKey(req);
    const result = await StipendService.bulkDisburse(
      req.params.idOrReference,
      req.userId!,
      key,
      req.body
    );
    ok(res, result, req.body.dry_run || (result as any).replayed ? 200 : 202);
  })
);

programsRouter.get(
  '/:idOrReference/disbursements',
  requireAuth,
  requireRole('INSTITUTION'),
  asyncHandler(async (req, res) => {
    ok(res, await StipendService.listDisbursements(req.params.idOrReference, req.userId!));
  })
);

/** /api/stipend-disbursements */
export const disbursementsRouter = Router();

disbursementsRouter.get(
  '/:idOrReference',
  requireAuth,
  requireRole('INSTITUTION'),
  asyncHandler(async (req, res) => {
    ok(res, await StipendService.getDisbursement(req.params.idOrReference, req.userId!));
  })
);

/** /api/stipends */
export const myStipendsRouter = Router();

myStipendsRouter.get(
  '/received',
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, await StipendService.receivedForUser(req.userId!));
  })
);
