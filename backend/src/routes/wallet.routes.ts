import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { WalletService } from '../services/wallet.service';
import { asyncHandler, ok } from '../utils/asyncHandler';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, await WalletService.getWallet(req.userId!));
  })
);

export default router;
