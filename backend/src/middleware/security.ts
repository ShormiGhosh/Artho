import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { correlationHash } from '../utils/crypto';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      clientIp: string;
      ipHash: string | null;
      uaHash: string | null;
    }
  }
}

/** Reject plain HTTP when running behind a TLS-terminating proxy. */
export function enforceHttps(req: Request, res: Response, next: NextFunction): void {
  if (!env.ENFORCE_HTTPS) return next();
  const proto = req.get('x-forwarded-proto');
  if (req.secure || proto === 'https') return next();
  res.status(403).json({
    success: false,
    error: { code: 'HTTPS_REQUIRED', message: 'This API is only available over HTTPS' },
  });
}

/** Attach hashed IP / user-agent for the security log (never store them raw). */
export function securityContext(req: Request, _res: Response, next: NextFunction): void {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
  req.clientIp = ip;
  req.ipHash = correlationHash(ip);
  req.uaHash = correlationHash(req.get('user-agent') || '');
  next();
}
