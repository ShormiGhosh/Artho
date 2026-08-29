import { Request, Response } from 'express';
import { env } from '../config/env';

/**
 * The refresh token travels ONLY as an httpOnly cookie, scoped to the auth
 * routes — JavaScript (and therefore an XSS payload) can never read it, and it
 * is never sent on ordinary API calls. The access token stays a normal
 * `Authorization: Bearer` JWT.
 *
 * No `cookie-parser` dependency: Express's `res.cookie()` is built in, and
 * reading the one cookie we care about is a five-line parse.
 */

const REFRESH_COOKIE = 'artho_refresh';

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
  });
}

export function readRefreshCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== REFRESH_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}
