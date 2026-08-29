/**
 * Application error carrying an HTTP status, a stable machine code and an
 * optional details bag. Thrown by services, translated to JSON by the
 * global error handler.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const Errors = {
  unauthorized: (message = 'Authentication required') =>
    new AppError('UNAUTHORIZED', message, 401),
  forbidden: (message = 'You do not have access to this resource') =>
    new AppError('FORBIDDEN', message, 403),
  invalidRequest: (message = 'Malformed request', details?: Record<string, unknown>) =>
    new AppError('INVALID_REQUEST', message, 400, details),
  invalidAmount: (message = 'Amount must be positive with at most 2 decimals') =>
    new AppError('INVALID_AMOUNT', message, 422),
  weakPassword: (message = 'Password must be at least 8 characters') =>
    new AppError('WEAK_PASSWORD', message, 422),
  emailTaken: () =>
    new AppError('EMAIL_ALREADY_REGISTERED', 'That email is already registered', 409),
  invalidCredentials: () =>
    new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect', 401),
  insufficientBalance: (details?: Record<string, unknown>) =>
    new AppError(
      'INSUFFICIENT_BALANCE',
      'Your available balance is less than the amount you tried to send',
      402,
      details
    ),
  selfTransfer: () =>
    new AppError('SELF_TRANSFER_NOT_ALLOWED', 'You cannot send money to yourself', 409),
  selfRequest: () =>
    new AppError('SELF_REQUEST_NOT_ALLOWED', 'You cannot request money from yourself', 409),
  userNotFound: (message = 'User not found') =>
    new AppError('USER_NOT_FOUND', message, 404),
  receiverNotFound: () =>
    new AppError('RECEIVER_NOT_FOUND', 'The recipient account no longer exists', 404),
  receiverInactive: () =>
    new AppError('RECEIVER_INACTIVE', 'The recipient account is not active', 409),
  transferNotFound: () =>
    new AppError('TRANSFER_NOT_FOUND', 'Transaction not found', 404),
  requestNotFound: () =>
    new AppError('REQUEST_NOT_FOUND', 'Money request not found', 404),
  requestNotPending: () =>
    new AppError('REQUEST_NOT_PENDING', 'This request has already been resolved', 409),
  missingIdempotencyKey: () =>
    new AppError('MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required', 400),
  idempotencyConflict: () =>
    new AppError(
      'IDEMPOTENCY_KEY_REUSED',
      'This Idempotency-Key was already used with a different request',
      409
    ),
  idempotencyInProgress: () =>
    new AppError(
      'REQUEST_IN_PROGRESS',
      'An identical request is still being processed. Please wait.',
      409
    ),
  rateLimited: () =>
    new AppError('RATE_LIMITED', 'Too many requests, slow down', 429),

  // Stipend / scholarship / grant programmes
  programNotFound: () =>
    new AppError('PROGRAM_NOT_FOUND', 'Programme not found', 404),
  programClosed: () =>
    new AppError('PROGRAM_CLOSED', 'This programme is closed', 409),
  beneficiaryNotFound: () =>
    new AppError('BENEFICIARY_NOT_FOUND', 'Beneficiary not found in this programme', 404),
  beneficiaryExists: () =>
    new AppError('BENEFICIARY_EXISTS', 'That user is already enrolled in this programme', 409),
  cannotEnrollInstitution: () =>
    new AppError('CANNOT_ENROLL_INSTITUTION', 'Institution accounts cannot be beneficiaries', 409),
  nidRequired: () =>
    new AppError('NID_REQUIRED', 'A valid guardian NID is required', 422),
  nidMismatch: () =>
    new AppError(
      'NID_MISMATCH',
      "The guardian NID does not match the beneficiary account's registered NID",
      409
    ),
  noDisbursementTargets: () =>
    new AppError(
      'NO_DISBURSEMENT_TARGETS',
      'No eligible beneficiaries to disburse to',
      422
    ),
  disbursementNotFound: () =>
    new AppError('DISBURSEMENT_NOT_FOUND', 'Disbursement not found', 404),
  internal: (message = 'An unexpected error occurred') =>
    new AppError('INTERNAL_ERROR', message, 500),
};
