import { Router } from 'express';
import { pool } from '../config/database';
import { checkInvariants } from '../services/invariant.service';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.status(200).json({
        status: 'healthy',
        database: 'ok',
        uptime_s: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({ status: 'unhealthy', database: 'error' });
    }
  })
);

router.get(
  '/invariants',
  asyncHandler(async (_req, res) => {
    const report = await checkInvariants();
    res.status(report.healthy ? 200 : 500).json(report);
  })
);

export default router;
