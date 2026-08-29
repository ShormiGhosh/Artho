import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
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
