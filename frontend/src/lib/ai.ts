import { api } from './api';
import type { AiStatus } from '../types';

/**
 * Small client-side helpers for the AI advisory layer. The backend already
 * validates and sanitises every AI string; this adds a defensive display cap
 * and a cached status probe so the UI can show the right affordances.
 */

let statusCache: { at: number; value: AiStatus } | null = null;

export async function getAiStatus(): Promise<AiStatus> {
  if (statusCache && Date.now() - statusCache.at < 60_000) return statusCache.value;
  try {
    const { data } = await api.get('/ai/status');
    statusCache = { at: Date.now(), value: data.data };
    return data.data as AiStatus;
  } catch {
    return { enabled: false, model: null };
  }
}

/** Defensive display sanitiser: strip control chars, collapse space, cap length. */
export function safeText(s: unknown, max = 600): string {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function safeList(v: unknown, maxItems = 10, maxLen = 280): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => safeText(x, maxLen)).filter(Boolean).slice(0, maxItems);
}

export const MONEY_STATUS_COPY: Record<
  'DELIVERED' | 'SAFE' | 'NEEDS_VERIFICATION',
  { label: string; tone: 'success' | 'warn' }
> = {
  DELIVERED: { label: 'Money delivered', tone: 'success' },
  SAFE: { label: 'Money is safe', tone: 'success' },
  NEEDS_VERIFICATION: { label: 'Needs verification', tone: 'warn' },
};
