import { Router } from 'express';
import { requireAuthAllowUnverified } from '../middleware/auth';
import { WalletService } from '../services/wallet.service';
import { asyncHandler, ok } from '../utils/asyncHandler';

const router = Router();

// Reading your own balance doesn't move money and doesn't leak anything to
// anyone else, so it's allowed even before email verification — the frontend
// uses this to know whether to show the "verify your email" screen.
router.get(
  '/',
  requireAuthAllowUnverified,
  asyncHandler(async (req, res) => {
    ok(res, await WalletService.getWallet(req.userId!));
  })
);

export default router;
