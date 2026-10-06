/**
 * Vendor lifecycle, operated by SUPER_ADMIN.
 *
 * Creating a vendor is the one place the platform hands someone the VENDOR
 * role, so it is deliberately an administrative action — a visitor cannot
 * self-register as a vendor (see `SELF_SIGNUP_ROLES`). Every status change is
 * audited, because approving or suspending a business is a decision someone may
 * later have to justify.
 */
import type { Prisma } from '@prisma/client';
import {
  UserRole,
  VendorStatus,
  type CreateVendorInput,
  type ListVendorsQuery,
  type PaginatedResult,
  type UpdateVendorStatusInput,
  type VendorSummary,
} from '@lunch/shared';
import { badRequest, conflict, notFound } from '../../core/errors';
import { buildPaginatedResult, toMoney, toSkipTake } from '../../core/http';
import { logger } from '../../core/logger';
import { prisma } from '../../core/prisma';
import { revokeAllUserTokens } from '../auth/token.service';

const vendorSelect = {
  id: true,
  businessName: true,
  legalName: true,
  status: true,
  isActive: true,
  commissionPct: true,
  contactEmail: true,
  contactPhone: true,
  gstin: true,
  approvedAt: true,
  createdAt: true,
  ownerUser: { select: { id: true, fullName: true, email: true, phone: true } },
  _count: {
    select: {
      kitchens: { where: { deletedAt: null } },
      meals: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.VendorSelect;

type VendorRow = Prisma.VendorGetPayload<{ select: typeof vendorSelect }>;

function toVendorSummary(row: VendorRow): VendorSummary {
  return {
    id: row.id,
    businessName: row.businessName,
    legalName: row.legalName,
    status: row.status as VendorStatus,
    isActive: row.isActive,
    commissionPct: toMoney(row.commissionPct),
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    gstin: row.gstin,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    owner: row.ownerUser,
    kitchenCount: row._count.kitchens,
    mealCount: row._count.meals,
  };
}

export async function listVendors(
  query: ListVendorsQuery
): Promise<PaginatedResult<VendorSummary>> {
  const where: Prisma.VendorWhereInput = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { businessName: { contains: query.search, mode: 'insensitive' } },
            { legalName: { contains: query.search, mode: 'insensitive' } },
            { contactEmail: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const { skip, take } = toSkipTake(query);
  const [rows, total] = await prisma.$transaction([
    prisma.vendor.findMany({
      where,
      select: vendorSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.vendor.count({ where }),
  ]);

  return buildPaginatedResult(rows.map(toVendorSummary), total, query);
}

export async function getVendor(vendorId: string): Promise<VendorSummary> {
  const row = await prisma.vendor.findFirst({
    where: { id: vendorId, deletedAt: null },
    select: vendorSelect,
  });
  if (!row) throw notFound('Vendor');
  return toVendorSummary(row);
}

/**
 * Creates a vendor and binds it to an owner account.
 *
 * The owner must already exist: creating a user here would mean inventing a
 * password, and an account whose password an administrator chose is worse than
 * asking the owner to register first and then be promoted.
 */
export async function createVendor(
  actorUserId: string,
  input: CreateVendorInput,
  context: { ip?: string; userAgent?: string } = {}
): Promise<VendorSummary> {
  const owner = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      ...(input.ownerEmail ? { email: input.ownerEmail } : { phone: input.ownerPhone }),
    },
    select: { id: true, role: true, vendor: { select: { id: true } } },
  });

  if (!owner) {
    throw badRequest(
      'No account found for that owner. Ask them to register first, then create the vendor.',
      { ownerEmail: ['No account with this email or phone'] }
    );
  }
  if (owner.vendor) {
    throw conflict('That account already operates a vendor');
  }
  if (owner.role === UserRole.SUPER_ADMIN) {
    throw badRequest('An administrator account cannot also be a vendor owner', {
      ownerEmail: ['This account is an administrator'],
    });
  }

  const vendor = await prisma.$transaction(async (tx) => {
    const created = await tx.vendor.create({
      data: {
        ownerUserId: owner.id,
        businessName: input.businessName,
        legalName: input.legalName ?? null,
        gstin: input.gstin ?? null,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        commissionPct: input.commissionPct.toFixed(2),
        // New vendors are not live until an administrator approves them.
        status: VendorStatus.PENDING_APPROVAL,
        isActive: false,
      },
      select: vendorSelect,
    });

    // The owner now operates a vendor, so give them the role.
    await tx.user.update({ where: { id: owner.id }, data: { role: UserRole.VENDOR } });

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: 'vendor.created',
        entityType: 'Vendor',
        entityId: created.id,
        after: { businessName: input.businessName, ownerUserId: owner.id },
        ip: context.ip ?? null,
        userAgent: context.userAgent?.slice(0, 255) ?? null,
      },
    });

    return created;
  });

  // Their access token still says CUSTOMER; force a fresh sign-in so the new
  // role and vendorId are picked up.
  await revokeAllUserTokens(owner.id);

  logger.info({ vendorId: vendor.id, ownerUserId: owner.id }, 'Vendor created');
  return toVendorSummary(vendor);
}

/**
 * Approves, rejects, suspends or restores a vendor.
 *
 * Suspension deactivates the vendor and its kitchens in the same transaction.
 *
 * It deliberately does **not** touch published availability. The catalog
 * already filters on `vendor.status === APPROVED && isActive`, so a suspended
 * vendor's meals are invisible either way — and closing the schedules would be
 * irreversible, because nothing records whether a CLOSED date was closed by the
 * suspension or by the vendor themselves. A one-day suspension would silently
 * destroy a month of forward inventory. Restoring a vendor now restores exactly
 * what they had.
 */
export async function updateVendorStatus(
  actorUserId: string,
  vendorId: string,
  input: UpdateVendorStatusInput,
  context: { ip?: string; userAgent?: string } = {}
): Promise<VendorSummary> {
  const existing = await prisma.vendor.findFirst({
    where: { id: vendorId, deletedAt: null },
    select: { id: true, status: true, approvedAt: true },
  });
  if (!existing) throw notFound('Vendor');

  if (existing.status === input.status) return getVendor(vendorId);

  const isLive = input.status === VendorStatus.APPROVED;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.vendor.update({
      where: { id: vendorId },
      data: {
        status: input.status,
        isActive: isLive,
        // Stamped on first approval and kept thereafter.
        ...(isLive && !existing.approvedAt ? { approvedAt: new Date() } : {}),
      },
      select: vendorSelect,
    });

    // Kitchens follow the vendor: a suspended business cannot keep selling.
    await tx.kitchen.updateMany({
      where: { vendorId, deletedAt: null },
      data: { isActive: isLive },
    });

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: 'vendor.status.updated',
        entityType: 'Vendor',
        entityId: vendorId,
        before: { status: existing.status },
        after: { status: input.status, reason: input.reason ?? null },
        ip: context.ip ?? null,
        userAgent: context.userAgent?.slice(0, 255) ?? null,
      },
    });

    return row;
  });

  logger.info(
    { actorUserId, vendorId, from: existing.status, to: input.status },
    'Vendor status changed'
  );
  return toVendorSummary(updated);
}
