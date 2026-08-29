import { NextFunction, Request, Response } from 'express';
import { Errors } from '../utils/errors';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Tiny in-memory fixed-window rate limiter. Good enough for a single-node
 * hackathon deployment; swap for Redis when horizontally scaled.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  key?: (req: Request) => string;
}) {
  const store = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const id = opts.key ? opts.key(req) : `${req.ip}:${req.path}`;
    const now = Date.now();
    const bucket = store.get(id);

    if (!bucket || now > bucket.resetAt) {
      store.set(id, { count: 1, resetAt: now + opts.windowMs });
      res.setHeader('X-RateLimit-Remaining', String(opts.max - 1));
      return next();
    }

    if (bucket.count >= opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return next(Errors.rateLimited());
    }

    bucket.count += 1;
    res.setHeader('X-RateLimit-Remaining', String(opts.max - bucket.count));
    next();
  };
}
