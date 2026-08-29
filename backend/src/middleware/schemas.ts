import { z } from 'zod';

const amountBdt = z
  .union([z.string(), z.number()])
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(String(v).trim()) && Number(v) > 0, {
    message: 'Amount must be a positive number with at most 2 decimal places',
  });

const nidField = z
  .string()
  .regex(/^(\d{10}|\d{13}|\d{17})$/, 'NID must be 10, 13 or 17 digits');

const phoneField = z
  .string()
  .regex(/^(?:\+?880|0)1[3-9]\d{8}$/, 'Enter a valid Bangladeshi phone number, e.g. 01712345678');

export const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  full_name: z.string().min(1).max(255),
  phone: phoneField,
  role: z.enum(['USER', 'INSTITUTION']).optional(),
  nid: nidField.optional(),
});

export const verifyEmailSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
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
  // Fault injection for demonstrating exactly-once / Smart Money Recovery.
  simulate: z
    .enum(['crash_before_processing', 'crash_during_processing', 'lost_response'])
    .optional()
    .nullable(),
  // Re-submitted with the verification token when a MEDIUM-risk transfer is confirmed.
  risk_ack: z.string().max(64).optional().nullable(),
});

export const riskConfigSchema = z
  .object({
    medium_threshold: z.coerce.number().int().min(0).max(100).optional(),
    high_threshold: z.coerce.number().int().min(0).max(100).optional(),
    large_amount_paisa: z.coerce.number().int().min(0).optional(),
    hard_cap_paisa: z.coerce.number().int().min(0).optional(),
    velocity_window_minutes: z.coerce.number().int().min(1).max(1440).optional(),
    velocity_max_transfers: z.coerce.number().int().min(1).max(1000).optional(),
    failed_window_minutes: z.coerce.number().int().min(1).max(1440).optional(),
    failed_max_transfers: z.coerce.number().int().min(1).max(1000).optional(),
    new_recipient_window_days: z.coerce.number().int().min(0).max(365).optional(),
    failed_login_window_minutes: z.coerce.number().int().min(1).max(1440).optional(),
    failed_login_max: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const reviewSchema = z.object({
  note: z.string().max(255).optional().nullable(),
});

// AI advisory layer
export const aiSummaryQuerySchema = z.object({
  period: z.enum(['weekly', 'monthly']).optional(),
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
  status: z
    .enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'VERIFYING', 'all'])
    .optional(),
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

export const createDebtGroupSchema = z.object({
  name: z.string().min(1).max(120),
  member_ids: z.array(z.string().uuid()).max(50).optional(),
});

export const addMemberSchema = z.object({ user_id: z.string().uuid() });

export const addDebtSchema = z.object({
  debtor_id: z.string().uuid(),
  creditor_id: z.string().uuid(),
  amount_bdt: amountBdt,
  description: z.string().max(200).optional().nullable(),
});

export const addExpenseSchema = z.object({
  payer_id: z.string().uuid(),
  amount_bdt: amountBdt,
  participant_ids: z.array(z.string().uuid()).min(1).max(50),
  description: z.string().max(200).optional().nullable(),
});

export const settleSchema = z.object({
  plan_hash: z.string().length(64).optional(),
});

export const requestListQuerySchema = z.object({
  direction: z.enum(['sent', 'received', 'all']).optional(),
  status: z
    .enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'all'])
    .optional(),
});
