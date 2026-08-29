import { Router } from 'express';
import { AuthService } from '../services/auth.service';
import { requireAuth, requireAuthAllowUnverified } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimit';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from '../middleware/schemas';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../utils/cookies';
import { Errors } from '../utils/errors';
import { asyncHandler, ok } from '../utils/asyncHandler';
import type { Request, Response } from 'express';

const router = Router();

/** Split a service result into the JSON-safe fields and the refresh pair, and
 *  set the httpOnly cookie for the latter. Keeps cookie handling (an HTTP
 *  concern) out of the service layer. */
function respondWithSession(
  res: Response,
  result: { refresh: { raw: string; expiresAt: Date }; [k: string]: unknown },
  status = 200
) {
  const { refresh, ...body } = result;
  setRefreshCookie(res, refresh.raw, refresh.expiresAt);
  ok(res, body, status);
}

router.post(
  '/register',
  // Bumped as the e2e script suite grew (each registers several users; running
  // all of them back-to-back was already documented as needing spacing).
  rateLimit({ windowMs: 60_000, max: 150 }),
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const result = await AuthService.register(req.body, {
      ipHash: req.ipHash,
      uaHash: req.uaHash,
    });
    respondWithSession(res, result, 201);
  })
);

router.post(
  '/login',
  rateLimit({ windowMs: 60_000, max: 40, key: (req) => `${req.ip}:login` }),
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    // Per-account temporary lockout (in AuthService) is the brute-force defence;
    // this IP limit is a coarse backstop.
    const result = await AuthService.login(req.body, {
      ipHash: req.ipHash,
      uaHash: req.uaHash,
    });
    respondWithSession(res, result);
  })
);

// No requireAuth: the access token may already be expired by the time someone
// wants a new one — the httpOnly refresh cookie is the only credential needed.
// Rotation + reuse detection live in RefreshTokenService.
router.post(
  '/refresh',
  rateLimit({ windowMs: 60_000, max: 30, key: (req) => `${req.ip}:refresh` }),
  asyncHandler(async (req: Request, res: Response) => {
    const raw = readRefreshCookie(req);
    if (!raw) throw Errors.unauthorized('No refresh session found. Please log in again.');
    try {
      const result = await AuthService.refreshSession(raw, { ipHash: req.ipHash, uaHash: req.uaHash });
      respondWithSession(res, result);
    } catch (err) {
      clearRefreshCookie(res);
      throw err;
    }
  })
);

router.post(
  '/logout',
  asyncHandler(async (req: Request, res: Response) => {
    await AuthService.logout(readRefreshCookie(req));
    clearRefreshCookie(res);
    ok(res, { message: 'Logged out' });
  })
);

router.get(
  '/me',
  requireAuthAllowUnverified,
  asyncHandler(async (req, res) => {
    ok(res, await AuthService.profile(req.userId!));
  })
);

router.patch(
  '/me',
  requireAuth,
  validate(updateProfileSchema),
  asyncHandler(async (req, res) => {
    ok(res, await AuthService.updateProfile(req.userId!, req.body));
  })
);

router.post(
  '/verify-email',
  requireAuthAllowUnverified,
  rateLimit({ windowMs: 60_000, max: 20, key: (req) => `${req.userId}:verify-email` }),
  validate(verifyEmailSchema),
  asyncHandler(async (req, res) => {
    ok(res, await AuthService.verifyEmail(req.userId!, req.body.code));
  })
);

router.post(
  '/resend-verification',
  requireAuthAllowUnverified,
  rateLimit({ windowMs: 60_000, max: 5, key: (req) => `${req.userId}:resend-verification` }),
  asyncHandler(async (req, res) => {
    ok(res, await AuthService.resendVerification(req.userId!));
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
      req.body.new_password,
      { ipHash: req.ipHash, uaHash: req.uaHash }
    );
    ok(res, { message: 'Password updated. You have been logged out everywhere else.' });
  })
);

export default router;
