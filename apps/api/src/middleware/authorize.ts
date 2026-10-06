import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UserRole } from '@lunch/shared';
import { forbidden } from '../core/errors';
import { requireAuth } from './authenticate';

/**
 * Role-based authorization. Always mounted *after* `authenticate`.
 *
 *   router.get('/orders', authenticate, authorize(UserRole.SUPER_ADMIN), handler)
 *
 * SUPER_ADMIN is not implicitly allowed everywhere: a route that admins should
 * reach must list them. Being explicit keeps "who can call this?" answerable by
 * reading one line.
 */
export function authorize(...allowed: UserRole[]): RequestHandler {
  if (allowed.length === 0) {
    throw new Error('authorize() requires at least one role');
  }
  return (req: Request, _res: Response, next: NextFunction) => {
    const { role } = requireAuth(req);
    if (!allowed.includes(role)) {
      return next(forbidden('Your role does not have access to this resource'));
    }
    next();
  };
}

/** Shorthands for the role groups that recur across the API. */
export const authorizeAdmin = () => authorize(UserRole.SUPER_ADMIN);
export const authorizeBuyer = () =>
  authorize(UserRole.CUSTOMER, UserRole.PARENT, UserRole.STUDENT);
export const authorizeVendor = () => authorize(UserRole.VENDOR, UserRole.SUPER_ADMIN);
export const authorizeDeliveryPartner = () =>
  authorize(UserRole.DELIVERY_PARTNER, UserRole.SUPER_ADMIN);

/**
 * Roles that may manage children and order on someone else's behalf.
 *
 * PARENT is the obvious one; CUSTOMER is included because the role a person
 * picks at sign-up does not always match what they end up doing — someone who
 * registered as a customer and later adds a child should not have to create a
 * second account. SUPER_ADMIN is deliberately absent: these endpoints are
 * scoped to the caller's own children, so an admin would only ever see an empty
 * list. Administrative oversight belongs under /admin.
 */
export const authorizeGuardian = () => authorize(UserRole.PARENT, UserRole.CUSTOMER);

/**
 * Ownership check for `/me`-style resources.
 *
 * Returns true when the principal owns the record, or is an admin acting on
 * someone else's behalf. Services call this rather than comparing ids inline,
 * so the admin-override rule lives in exactly one place.
 */
export function canActOnUser(req: Request, ownerUserId: string): boolean {
  const auth = requireAuth(req);
  return auth.userId === ownerUserId || auth.role === UserRole.SUPER_ADMIN;
}

export function assertCanActOnUser(req: Request, ownerUserId: string): void {
  if (!canActOnUser(req, ownerUserId)) {
    throw forbidden('You can only access your own records');
  }
}
