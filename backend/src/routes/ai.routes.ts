import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimit';
import { aiSummaryQuerySchema } from '../middleware/schemas';
import { env } from '../config/env';
import { AIService } from '../services/ai/aiService';
import { InvestigationService } from '../services/investigation.service';
import { SummaryService } from '../services/summary.service';
import { asyncHandler, ok } from '../utils/asyncHandler';

const router = Router();

router.use(requireAuth);

// Per-user cap to control OpenAI cost. Endpoints are also cached server-side.
const aiRateLimit = rateLimit({
  windowMs: 60_000,
  max: Math.max(1, env.AI_RATE_LIMIT_PER_MIN),
  key: (req) => `${req.userId}:ai`,
});

/** Whether the AI layer is configured. Never returns the API key. */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    ok(res, { enabled: AIService.enabled, model: AIService.enabled ? AIService.model : null });
  })
);

/**
 * Feature 1 — "What happened to my money?". Authorises the caller, reconciles the
 * transfer against the immutable ledger (idempotent, no money moves), then
 * returns a human-readable explanation. Falls back to a deterministic
 * explanation if AI is unavailable.
 */
router.post(
  '/transactions/:idOrReference/investigate',
  aiRateLimit,
  asyncHandler(async (req, res) => {
    ok(res, await InvestigationService.investigate(req.params.idOrReference, req.userId!));
  })
);

/**
 * Feature 3 — Smart Financial Summary. All totals are computed from the database;
 * the AI only narrates them. Cached per (user, period).
 */
router.get(
  '/summary',
  aiRateLimit,
  validate(aiSummaryQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const period = ((req.query as any).period ?? 'monthly') as 'weekly' | 'monthly';
    ok(res, await SummaryService.financialSummary(req.userId!, period));
  })
);

export default router;
