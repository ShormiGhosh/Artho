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

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return next(Errors.unauthorized('Missing bearer token'));
  }
  const payload = verifyToken(header.slice(7).trim());
  req.userId = payload.user_id;
  next();
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
