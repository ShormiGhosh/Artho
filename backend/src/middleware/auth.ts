import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { pool } from '../config/database';
import { Errors } from '../utils/errors';

export interface JwtPayload {
  user_id: string;
  iat?: number;
  exp?: number;
}

export function signToken(userId: string): string {
  return jwt.sign({ user_id: userId }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRATION,
  });
}

export function verifyToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch {
    throw Errors.unauthorized('Invalid or expired token');
  }
}

async function authenticate(
  req: Request,
  next: NextFunction,
  allowedStatuses: readonly string[]
): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return next(Errors.unauthorized('Missing bearer token'));
    }
    const payload = verifyToken(header.slice(7).trim());

    // Session invalidation: tokens issued before the last password change are dead.
    const { rows } = await pool.query(
      'SELECT account_status, EXTRACT(EPOCH FROM password_changed_at) AS pwd_epoch FROM users WHERE id = $1',
      [payload.user_id]
    );
    if (rows.length === 0 || !allowedStatuses.includes(rows[0].account_status)) {
      return next(Errors.unauthorized('Account not available'));
    }
    if (payload.iat && Number(rows[0].pwd_epoch) > payload.iat + 1) {
      return next(Errors.unauthorized('Session expired — please log in again'));
    }

    req.userId = payload.user_id;
    next();
  } catch (err) {
    next(err);
  }
}

/** Standard gate: only a fully ACTIVE account may proceed. Used everywhere
 *  money moves or account data is written. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  return authenticate(req, next, ['ACTIVE']);
}

/**
 * Same authentication, but also lets a PENDING_VERIFICATION account through.
 * Reserved for the handful of self-service routes an unverified user must
 * still reach: reading their own profile/wallet, verifying, resending the
 * code, and logging out. Every money-moving route stays on `requireAuth`.
 */
export async function requireAuthAllowUnverified(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  return authenticate(req, next, ['ACTIVE', 'PENDING_VERIFICATION']);
}

/**
 * Gate a route on the caller's account role. Must run after `requireAuth`.
 * Looks the role up fresh so a demotion takes effect immediately.
 */
export function requireRole(...roles: string[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) return next(Errors.unauthorized());
      const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [req.userId]);
      if (rows.length === 0) return next(Errors.unauthorized());
      if (!roles.includes(rows[0].role)) {
        return next(Errors.forbidden(`This action requires role: ${roles.join(' or ')}`));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
