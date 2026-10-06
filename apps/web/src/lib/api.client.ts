'use client';

/**
 * Browser-side API client.
 *
 * It calls this app's own `/api/*` proxy rather than the API's origin, so the
 * httpOnly session cookies are first-party and get sent automatically.
 */
import type { ApiErrorBody } from '@lunch/shared';
import { ApiError } from './api-error';

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const { method = 'GET', body } = init;

  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    credentials: 'same-origin',
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : undefined;

  if (!res.ok) throw new ApiError(res.status, parsed as ApiErrorBody);

  return (parsed as { data: T }).data;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export { ApiError };
