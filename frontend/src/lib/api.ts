import axios, { AxiosError } from 'axios';

const TOKEN_KEY = 'artho_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

api.interceptors.response.use(
  (r) => r,
  (error: AxiosError<any>) => {
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

/** Stable idempotency key for a money mutation; format matches backend expectations. */
export function newIdempotencyKey(userId: string): string {
  const rnd =
    crypto.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(16).slice(2, 18);
  return `req-${userId}-${Date.now()}-${rnd}`;
}
