import axios, { AxiosError } from 'axios';

const TOKEN_KEY = 'artho_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

// `withCredentials` lets the browser send/receive the httpOnly refresh-token
// cookie (scoped server-side to /api/auth) on every request. The access token
// itself still travels as a normal Bearer header from localStorage below.
export const api = axios.create({ baseURL: '/api', withCredentials: true });

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

// Endpoints where a 401 means exactly what it says (bad password, no session
// to refresh, or the refresh call itself failed) — never chase these with a
// silent refresh-and-retry.
const NO_REFRESH_RETRY = ['/auth/login', '/auth/register', '/auth/refresh'];

let refreshInFlight: Promise<string | null> | null = null;

/** Single-flight refresh: concurrent 401s all await the same in-flight call
 *  instead of each racing their own /auth/refresh (which would trip reuse
 *  detection against each other). */
function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = api
      .post('/auth/refresh')
      .then((res) => {
        const token = res.data?.data?.token as string | undefined;
        if (token) tokenStore.set(token);
        return token ?? null;
      })
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<any>) => {
    const config = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
    const url = config?.url ?? '';

    if (
      error.response?.status === 401 &&
      config &&
      !config._retry &&
      !NO_REFRESH_RETRY.some((p) => url.includes(p))
    ) {
      config._retry = true;
      const newToken = await refreshAccessToken();
      if (newToken) {
        config.headers = config.headers ?? {};
        (config.headers as any).Authorization = `Bearer ${newToken}`;
        return api(config);
      }
      tokenStore.clear();
      if (onUnauthorized) onUnauthorized();
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && onUnauthorized) onUnauthorized();
    return Promise.reject(error);
  }
);

/** Extracts a human-readable, actionable message from an API error. */
export function errorMessage(err: unknown): string {
  const ax = err as AxiosError<any>;
  return (
    ax?.response?.data?.error?.message ||
    ax?.message ||
    'Something went wrong. Please try again.'
  );
}

export function errorCode(err: unknown): string | undefined {
  return (err as AxiosError<any>)?.response?.data?.error?.code;
}

export function errorDetails(err: unknown): Record<string, any> | undefined {
  return (err as AxiosError<any>)?.response?.data?.error?.details;
}

/** Stable idempotency key for a money mutation; format matches backend expectations. */
export function newIdempotencyKey(userId: string): string {
  const rnd =
    crypto.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(16).slice(2, 18);
  return `req-${userId}-${Date.now()}-${rnd}`;
}
