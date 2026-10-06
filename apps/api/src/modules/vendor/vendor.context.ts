/**
 * Resolving "which vendor is this request acting as".
 *
 * Every vendor service takes a `vendorId` and scopes its queries by it, the
 * same way the children module scopes by `parentId`. This module is the single
 * place that id is derived, so there is exactly one answer to "whose data is
 * this?" rather than a judgement made at each call site.
 *
 * The id is read from the database by owner, not taken from the access token.
 * The token's `vendorId` claim is a convenience for clients; trusting it here
 * would mean a stale token (issued before the vendor was created, or after it
 * was transferred) could point at the wrong business.
 */
import type { Request } from 'express';
import { UserRole, VendorStatus } from '@lunch/shared';
import { forbidden, notFound } from '../../core/errors';
import { toMoney } from '../../core/http';
import { prisma } from '../../core/prisma';
import { requireAuth } from '../../middleware/authenticate';

export interface VendorContext {
  vendorId: string;
  status: VendorStatus;
  commissionPct: string;
  businessName: string;
}

/**
 * The vendor the caller operates.
 *
 * An admin may act on a specific vendor by passing `?vendorId=` for support
 * purposes; for everyone else the parameter is ignored entirely, so it can
 * never be used to reach another business's data.
 */
export async function resolveVendorContext(req: Request): Promise<VendorContext> {
  const auth = requireAuth(req);

  if (auth.role === UserRole.SUPER_ADMIN) {
    const requested = (req.query as { vendorId?: string } | undefined)?.vendorId;
    if (!requested) {
      throw notFound('Vendor profile');
    }
    const vendor = await prisma.vendor.findFirst({
      where: { id: requested, deletedAt: null },
      select: { id: true, status: true, commissionPct: true, businessName: true },
    });
    if (!vendor) throw notFound('Vendor');
    return {
      vendorId: vendor.id,
      status: vendor.status as VendorStatus,
      commissionPct: toMoney(vendor.commissionPct),
      businessName: vendor.businessName,
    };
  }

  const vendor = await prisma.vendor.findFirst({
    where: { ownerUserId: auth.userId, deletedAt: null },
    select: { id: true, status: true, commissionPct: true, businessName: true },
  });

  if (!vendor) throw notFound('Vendor profile');

  return {
    vendorId: vendor.id,
    status: vendor.status as VendorStatus,
    commissionPct: toMoney(vendor.commissionPct),
    businessName: vendor.businessName,
  };
}

/**
 * For writes. A vendor awaiting approval, rejected or suspended may still read
 * their own data — seeing why they cannot trade is useful — but must not change
 * menus, capacity or order state.
 */
export function assertVendorCanTrade(context: VendorContext): void {
  if (context.status === VendorStatus.APPROVED) return;

  const reason: Record<string, string> = {
    [VendorStatus.PENDING_APPROVAL]:
      'Your vendor account is awaiting approval. You can review your details, but not change them yet.',
    [VendorStatus.REJECTED]: 'Your vendor application was not approved.',
    [VendorStatus.SUSPENDED]: 'Your vendor account is suspended. Contact support to restore it.',
  };

  throw forbidden(reason[context.status] ?? 'Your vendor account is not active');
}

/**
 * Confirms a kitchen belongs to this vendor.
 *
 * Returns the id so callers can use it directly; throws 404 (not 403) for
 * someone else's kitchen, so the API does not confirm it exists.
 */
export async function assertKitchenBelongsToVendor(
  vendorId: string,
  kitchenId: string
): Promise<string> {
  const kitchen = await prisma.kitchen.findFirst({
    where: { id: kitchenId, vendorId, deletedAt: null },
    select: { id: true },
  });
  if (!kitchen) throw notFound('Kitchen');
  return kitchen.id;
}
