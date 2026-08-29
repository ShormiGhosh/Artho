import { z } from 'zod';

const amountBdt = z
  .union([z.string(), z.number()])
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(String(v).trim()) && Number(v) > 0, {
    message: 'Amount must be a positive number with at most 2 decimal places',
  });

const nidField = z
  .string()
  .regex(/^(\d{10}|\d{13}|\d{17})$/, 'NID must be 10, 13 or 17 digits');

export const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  full_name: z.string().min(1).max(255),
  role: z.enum(['USER', 'INSTITUTION']).optional(),
  nid: nidField.optional(),
});

export const updateProfileSchema = z
  .object({
    full_name: z.string().min(1).max(255).optional(),
    nid: nidField.nullable().optional(),
  })
  .refine((v) => v.full_name !== undefined || v.nid !== undefined, {
    message: 'Provide full_name or nid',
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

export const rejectRequestSchema = z.object({
  reason: z.string().max(200).optional().nullable(),
});

export const lookupQuerySchema = z.object({
  ref: z.string().min(3).max(64),
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

const amountBdtOptional = z
  .union([z.string(), z.number()])
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(String(v).trim()) && Number(v) > 0, {
    message: 'Amount must be a positive number with at most 2 decimal places',
  })
  .optional()
  .nullable();

export const createProgramSchema = z.object({
  name: z.string().min(1).max(150),
  category: z.enum(['STIPEND', 'SCHOLARSHIP', 'GRANT']).optional(),
  description: z.string().max(500).optional().nullable(),
});

export const enrollBeneficiarySchema = z.object({
  user_id: z.string().uuid(),
  guardian_nid: nidField,
  institution_name: z.string().min(1).max(150),
  default_amount_bdt: amountBdtOptional,
});

export const updateBeneficiarySchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    guardian_nid: nidField.optional(),
    institution_name: z.string().min(1).max(150).optional(),
    default_amount_bdt: amountBdtOptional,
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

// An empty body is valid: it means "pay every active beneficiary at their
// per-beneficiary default amount". `amount_bdt` supplies a flat fallback;
// `items` targets a specific subset.
export const disburseSchema = z.object({
  note: z.string().max(255).optional().nullable(),
  amount_bdt: amountBdtOptional,
  items: z
    .array(
      z.object({
        user_id: z.string().uuid(),
        amount_bdt: amountBdtOptional,
      })
    )
    .max(500)
    .optional(),
});

export const bulkDisburseSchema = z.object({
  note: z.string().max(255).optional().nullable(),
  default_amount_bdt: amountBdtOptional,
  default_institution_name: z.string().max(150).optional().nullable(),
  auto_enroll: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  rows: z
    .array(
      z
        .object({
          user_id: z.string().uuid().optional(),
          email: z.string().email().max(255).optional(),
          nid: nidField.optional(),
          guardian_nid: nidField.optional(),
          institution_name: z.string().max(150).optional(),
          amount_bdt: amountBdtOptional,
        })
        .refine((r) => !!(r.user_id || r.email || r.nid), {
          message: 'each row needs user_id, email or nid',
        })
    )
    .min(1)
    .max(5000),
});

export const requestListQuerySchema = z.object({
  direction: z.enum(['sent', 'received', 'all']).optional(),
  status: z
    .enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'all'])
    .optional(),
});
