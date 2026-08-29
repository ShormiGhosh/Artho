import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { reviewSchema, riskConfigSchema } from '../middleware/schemas';
import { SecurityService } from '../services/security.service';
import { AppError } from '../utils/errors';
import { asyncHandler, ok } from '../utils/asyncHandler';

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

router.get(
  '/dashboard',
  asyncHandler(async (_req, res) => ok(res, await SecurityService.dashboard()))
);

router.get(
  '/assessments',
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    ok(
      res,
      await SecurityService.listAssessments({
        band: q.band,
        decision: q.decision,
        page: q.page ? Number(q.page) : undefined,
      })
    );
  })
);

router.get(
  '/assessments/:idOrReference',
  asyncHandler(async (req, res) => {
    ok(res, await SecurityService.getAssessment(req.params.idOrReference));
  })
);

router.post(
  '/assessments/:id/release',
  validate(reviewSchema),
  asyncHandler(async (req, res) => {
    ok(res, await SecurityService.release(req.params.id, req.userId!, req.body.note ?? null));
  })
);

router.post(
  '/assessments/:id/reject',
  validate(reviewSchema),
  asyncHandler(async (req, res) => {
    ok(res, await SecurityService.reject(req.params.id, req.userId!, req.body.note ?? null));
  })
);

// Run (or refresh) the advisory AI fraud analysis for one assessment. This is a
// second opinion only — it never changes the deterministic score/band/decision.
router.post(
  '/assessments/:id/ai-analysis',
  asyncHandler(async (req, res) => {
    const analysis = await SecurityService.runAiAnalysis(req.params.id);
    if (!analysis) throw new AppError('ASSESSMENT_NOT_FOUND', 'Assessment not found', 404);
    ok(res, { ai_analysis: analysis });
  })
);

router.get(
  '/events',
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    ok(
      res,
      await SecurityService.listEvents({
        type: q.type,
        severity: q.severity,
        page: q.page ? Number(q.page) : undefined,
      })
    );
  })
);

router.get(
  '/config',
  asyncHandler(async (_req, res) => ok(res, await SecurityService.getConfigRaw()))
);

router.put(
  '/config',
  validate(riskConfigSchema),
  asyncHandler(async (req, res) => {
    ok(res, await SecurityService.updateConfig(req.userId!, req.body));
  })
);

export default router;
