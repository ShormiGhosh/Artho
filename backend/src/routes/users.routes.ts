import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { searchQuerySchema } from '../middleware/schemas';
import { UserService } from '../services/user.service';
import { asyncHandler, ok } from '../utils/asyncHandler';
import { Errors } from '../utils/errors';

const router = Router();

router.get(
  '/search',
  requireAuth,
  validate(searchQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const results = await UserService.search(
      req.userId!,
      req.query.q as string,
      req.query.limit ? Number(req.query.limit) : 10
    );
    ok(res, { results });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile = await UserService.getPublicProfile(req.params.id);
    if (!profile) throw Errors.userNotFound();
    ok(res, profile);
  })
);

export default router;
