/**
 * Server-side API client.
 *
 * Used from server components, server actions and route handlers. It forwards
 * the incoming request's cookies so the API sees the signed-in user, and never
 * caches, because every call is user-specific.
 */
import { cookies } from 'next/headers';
import type { ApiErrorBody } from '@lunch/shared';
import { API_PREFIX, serverConfig } from './config';
import { ApiError } from './api-error';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Extra headers; `Cookie` and `Content-Type` are set for you. */
  headers?: Record<string, string>;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const res = await fetch(`${serverConfig.apiBaseUrl}${API_PREFIX}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : undefined;

  if (!res.ok) throw new ApiError(res.status, parsed as ApiErrorBody);

  return (parsed as { data: T }).data;
}

/**
 * Like `request`, but keeps the `meta` block alongside the data.
 *
 * Paginated and faceted endpoints answer `{ data, meta }`; the plain `get`
 * unwraps to `data` and discards `meta`, which is right for most callers but
 * loses the facet counts and totals a list screen needs.
 */
async function requestWithMeta<T, M>(path: string): Promise<{ data: T; meta: M }> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const res = await fetch(`${serverConfig.apiBaseUrl}${API_PREFIX}${path}`, {
    headers: {
      Accept: 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    cache: 'no-store',
  });

  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, parsed as ApiErrorBody);

  return parsed as { data: T; meta: M };
}

export const apiServer = {
  get: <T>(path: string, headers?: Record<string, string>) => request<T>(path, { headers }),
  getWithMeta: <T, M>(path: string) => requestWithMeta<T, M>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
