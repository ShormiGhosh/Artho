import { z } from 'zod';

const amountBdt = z
  .union([z.string(), z.number()])
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(String(v).trim()) && Number(v) > 0, {
    message: 'Amount must be a positive number with at most 2 decimal places',
  });

export const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  full_name: z.string().min(1).max(255),
});

export const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: z.string().min(8).max(200),
});

export const transferSchema = z.object({
  receiver_id: z.string().uuid(),
  amount_bdt: amountBdt,
  note: z.string().max(500).optional().nullable(),
});

export const moneyRequestSchema = z.object({
  requestee_id: z.string().uuid(),
  amount_bdt: amountBdt,
  reason: z.string().max(200).optional().nullable(),
});

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const listTransfersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'all']).optional(),
  direction: z.enum(['sent', 'received', 'all']).optional(),
});

export const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  kind: z.enum(['TRANSFER', 'REQUEST', 'all']).optional(),
  status: z.string().max(20).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const requestListQuerySchema = z.object({
  direction: z.enum(['sent', 'received', 'all']).optional(),
  status: z
    .enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'all'])
    .optional(),
});
