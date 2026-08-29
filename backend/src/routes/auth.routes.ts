import { Router } from 'express';
import { AuthService } from '../services/auth.service';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimit';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
} from '../middleware/schemas';
import { asyncHandler, ok } from '../utils/asyncHandler';

const router = Router();

router.post(
  '/register',
  rateLimit({ windowMs: 60_000, max: 10 }),
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const result = await AuthService.register(req.body);
    ok(res, result, 201);
  })
);

router.post(
  '/login',
  rateLimit({ windowMs: 60_000, max: 5, key: (req) => `${req.ip}:login` }),
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await AuthService.login(req.body);
    ok(res, result);
  })
);

router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (_req, res) => {
    // Stateless JWT: logout is client-side token disposal. Endpoint exists for symmetry.
    ok(res, { message: 'Logged out' });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, await AuthService.profile(req.userId!));
  })
);

router.post(
  '/change-password',
  requireAuth,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    await AuthService.changePassword(
      req.userId!,
      req.body.current_password,
      req.body.new_password
    );
    ok(res, { message: 'Password updated' });
  })
);

export default router;
