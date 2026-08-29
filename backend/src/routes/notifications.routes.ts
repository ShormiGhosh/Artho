import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { NotificationService } from '../services/notification.service';
import { asyncHandler, ok } from '../utils/asyncHandler';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const unreadOnly = req.query.unread === 'true';
    const [notifications, unread_count] = await Promise.all([
      NotificationService.list(req.userId!, unreadOnly),
      NotificationService.unreadCount(req.userId!),
    ]);
    ok(res, { notifications, unread_count });
  })
);

router.post(
  '/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    await NotificationService.markRead(req.userId!, req.params.id);
    ok(res, { message: 'marked read' });
  })
);

router.post(
  '/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await NotificationService.markAllRead(req.userId!);
    ok(res, { message: 'all marked read' });
  })
);

export default router;
