import { Router } from 'express';
import authRoutes from './auth.routes';
import walletRoutes from './wallet.routes';
import usersRoutes from './users.routes';
import transfersRoutes from './transfers.routes';
import requestsRoutes from './requests.routes';
import historyRoutes from './history.routes';
import notificationsRoutes from './notifications.routes';
import healthRoutes from './health.routes';

const api = Router();

api.use('/health', healthRoutes);
api.use('/auth', authRoutes);
api.use('/wallet', walletRoutes);
api.use('/users', usersRoutes);
api.use('/transfers', transfersRoutes);
api.use('/money-requests', requestsRoutes);
api.use('/transactions', historyRoutes);
api.use('/notifications', notificationsRoutes);

export default api;
