/**
 * Server-side session access.
 *
 * `getSession` is cached per request with React's `cache`, so a layout and
 * three nested server components asking "who is signed in?" cost one API call.
 */
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { PublicUser, UserRole } from '@lunch/shared';
import { apiServer } from './api.server';
import { isApiError } from './api-error';

export const getSession = cache(async (): Promise<PublicUser | null> => {
  try {
    const { user } = await apiServer.get<{ user: PublicUser }>('/auth/me');
    return user;
  } catch (err) {
    // A 401 just means "not signed in" — not an error worth surfacing.
    if (isApiError(err) && err.status === 401) return null;
    throw err;
  }
});

/**
 * Like `getSession`, but treats an unreachable API as "not signed in".
 *
 * Only for public pages whose job does not depend on the answer — the landing
 * page uses the session merely to redirect a signed-in visitor, and a marketing
 * page returning 500 because the API is restarting is a worse outcome than
 * showing it anonymously. Authenticated screens must keep using `getSession`,
 * so an outage surfaces instead of silently signing people out.
 */
export const getSessionOptional = cache(async (): Promise<PublicUser | null> => {
  try {
    return await getSession();
  } catch {
    return null;
  }
});

/** Requires a signed-in user, else sends them to sign in and back again. */
export async function requireUser(returnTo?: string): Promise<PublicUser> {
  const user = await getSession();
  if (!user) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login';
    redirect(target);
  }
  return user;
}

/** Requires one of `roles`. Anyone signed in but wrong-rolled gets sent home. */
export async function requireRole(roles: readonly UserRole[], returnTo?: string): Promise<PublicUser> {
  const user = await requireUser(returnTo);
  if (!roles.includes(user.role)) redirect('/');
  return user;
}

/** Where a user lands after signing in, by role. */
export function homePathForRole(role: UserRole): string {
  switch (role) {
    case 'VENDOR':
      return '/vendor';
    case 'DELIVERY_PARTNER':
      return '/delivery';
    case 'SUPER_ADMIN':
      return '/admin';
    case 'INSTITUTION_ADMIN':
      return '/institution';
    default:
      return '/meals';
  }
}
