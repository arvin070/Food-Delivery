/**
 * Server-only configuration for the web app.
 *
 * `API_INTERNAL_URL` is the address the Next.js *server* uses to reach the API.
 * It is deliberately not a `NEXT_PUBLIC_` variable: the browser must never call
 * the API directly, or the httpOnly auth cookies would become cross-origin.
 */
export const serverConfig = {
  apiBaseUrl: (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'Lunch',
} as const;

export const API_PREFIX = '/api/v1';
