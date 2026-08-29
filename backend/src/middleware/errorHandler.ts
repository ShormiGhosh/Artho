import { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
    request_id: req.requestId,
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) return;

  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error('request failed', err, { requestId: req.requestId });
    }
    res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
      request_id: req.requestId,
    });
    return;
  }

  // Postgres constraint violations -> friendly, still-correct responses.
  const pgErr = err as { code?: string; constraint?: string };
  if (pgErr?.code === '23505') {
    res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'Duplicate resource', details: { constraint: pgErr.constraint } },
      request_id: req.requestId,
    });
    return;
  }
  if (pgErr?.code === '23514' && pgErr.constraint?.includes('balance')) {
    res.status(402).json({
      success: false,
      error: {
        code: 'INSUFFICIENT_BALANCE',
        message: 'Your available balance is less than the amount you tried to send',
      },
      request_id: req.requestId,
    });
    return;
  }

  logger.error('unhandled error', err, { requestId: req.requestId });
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    request_id: req.requestId,
  });
}
