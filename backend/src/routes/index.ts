import { Router } from 'express';
import authRoutes from './auth.routes';
import walletRoutes from './wallet.routes';
import usersRoutes from './users.routes';
import transfersRoutes from './transfers.routes';
import requestsRoutes from './requests.routes';
import historyRoutes from './history.routes';
import notificationsRoutes from './notifications.routes';
import healthRoutes from './health.routes';
import {
  disbursementsRouter,
  myStipendsRouter,
  programsRouter,
} from './stipends.routes';
import { debtGroupsRouter, debtSettlementsRouter } from './debt.routes';
import securityRoutes from './security.routes';
import aiRoutes from './ai.routes';

const api = Router();

api.use('/health', healthRoutes);
api.use('/auth', authRoutes);
api.use('/wallet', walletRoutes);
api.use('/users', usersRoutes);
api.use('/transfers', transfersRoutes);
api.use('/money-requests', requestsRoutes);
api.use('/transactions', historyRoutes);
api.use('/notifications', notificationsRoutes);
api.use('/stipend-programs', programsRouter);
api.use('/stipend-disbursements', disbursementsRouter);
api.use('/stipends', myStipendsRouter);
api.use('/debt-groups', debtGroupsRouter);
api.use('/debt-settlements', debtSettlementsRouter);
api.use('/security', securityRoutes);
api.use('/ai', aiRoutes);

export default api;
