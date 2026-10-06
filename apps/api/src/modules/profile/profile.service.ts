/**
 * Customer profile.
 *
 * Profile data is split across two tables — identity on `User` (name, email,
 * phone, which authentication depends on) and preferences on `UserProfile`.
 * This service presents them as one object, and writes both in a transaction so
 * a half-applied update is impossible.
 */
import type { Prisma } from '@prisma/client';
import {
  ErrorCode,
  type CustomerProfile,
  type DietaryPreference,
  type UpdateProfileInput,
} from '@lunch/shared';
import { badRequest, conflict, notFound } from '../../core/errors';
import { logger } from '../../core/logger';
import { prisma } from '../../core/prisma';

const profileInclude = {
  profile: {
    include: {
      defaultCheckpoint: { select: { id: true, name: true } },
      defaultTimeSlot: { select: { id: true, label: true } },
      city: { select: { id: true, name: true } },
    },
  },
  _count: { select: { children: { where: { deletedAt: null } } } },
} satisfies Prisma.UserInclude;

type ProfileRow = Prisma.UserGetPayload<{ include: typeof profileInclude }>;

function toCustomerProfile(row: ProfileRow): CustomerProfile {
  const p = row.profile;
  return {
    userId: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    role: row.role,
    emailVerified: Boolean(row.emailVerifiedAt),
    phoneVerified: Boolean(row.phoneVerifiedAt),

    dateOfBirth: p?.dateOfBirth ? p.dateOfBirth.toISOString().slice(0, 10) : null,
    avatarUrl: p?.avatarUrl ?? null,
    dietaryPreference: (p?.dietaryPreference ?? 'NONE') as DietaryPreference,
    allergies: p?.allergies ?? null,
    foodPreferences: p?.foodPreferences ?? [],

    defaultCheckpoint: p?.defaultCheckpoint
      ? { id: p.defaultCheckpoint.id, name: p.defaultCheckpoint.name }
      : null,
    defaultTimeSlot: p?.defaultTimeSlot
      ? { id: p.defaultTimeSlot.id, name: p.defaultTimeSlot.label }
      : null,
    city: p?.city ? { id: p.city.id, name: p.city.name } : null,

    emergencyContactName: p?.emergencyContactName ?? null,
    emergencyContactPhone: p?.emergencyContactPhone ?? null,
    emergencyContactRelation: p?.emergencyContactRelation ?? null,

    childCount: row._count.children,
  };
}

export async function getProfile(userId: string): Promise<CustomerProfile> {
  const row = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: profileInclude,
  });
  if (!row) throw notFound('Profile');
  return toCustomerProfile(row);
}

/** Checks that referenced lookups exist, so the form gets a field-level error. */
async function assertReferencesExist(input: UpdateProfileInput): Promise<void> {
  const details: Record<string, string[]> = {};

  if (input.defaultCheckpointId) {
    const found = await prisma.checkpoint.count({
      where: { id: input.defaultCheckpointId, isActive: true },
    });
    if (!found) details['defaultCheckpointId'] = ['That checkpoint was not found'];
  }
  if (input.defaultTimeSlotId) {
    const found = await prisma.timeSlot.count({
      where: { id: input.defaultTimeSlotId, isActive: true },
    });
    if (!found) details['defaultTimeSlotId'] = ['That delivery time was not found'];
  }
  if (input.cityId) {
    const found = await prisma.city.count({ where: { id: input.cityId, isActive: true } });
    if (!found) details['cityId'] = ['That city was not found'];
  }

  if (Object.keys(details).length > 0) {
    throw badRequest('Some of the selected options are no longer available', details);
  }
}

/**
 * Updates the profile.
 *
 * Changing email or phone clears the corresponding verification flag: the new
 * address has not been proven, and carrying the old flag over would let someone
 * swap in an unverified contact while still looking verified.
 */
export async function updateProfile(
  userId: string,
  input: UpdateProfileInput
): Promise<CustomerProfile> {
  const current = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, email: true, phone: true },
  });
  if (!current) throw notFound('Profile');

  await assertReferencesExist(input);

  // Identity fields are unique; check first so the error names the field.
  if (input.email && input.email !== current.email) {
    const taken = await prisma.user.findFirst({
      where: { email: input.email, id: { not: userId } },
      select: { id: true },
    });
    if (taken) throw conflict('That email address is already in use', ErrorCode.EMAIL_TAKEN);
  }
  if (input.phone && input.phone !== current.phone) {
    const taken = await prisma.user.findFirst({
      where: { phone: input.phone, id: { not: userId } },
      select: { id: true },
    });
    if (taken) throw conflict('That phone number is already in use', ErrorCode.PHONE_TAKEN);
  }

  // An account must keep at least one way to sign in.
  const nextEmail = input.email !== undefined ? input.email : current.email;
  const nextPhone = input.phone !== undefined ? input.phone : current.phone;
  if (!nextEmail && !nextPhone) {
    throw badRequest('Keep at least an email address or a phone number on your account', {
      email: ['An email address or phone number is required'],
    });
  }

  const userData: Prisma.UserUpdateInput = {};
  if (input.fullName !== undefined) userData.fullName = input.fullName;
  if (input.email !== undefined && input.email !== current.email) {
    userData.email = input.email;
    userData.emailVerifiedAt = null;
  }
  if (input.phone !== undefined && input.phone !== current.phone) {
    userData.phone = input.phone;
    userData.phoneVerifiedAt = null;
  }

  const profileData = {
    ...(input.dateOfBirth !== undefined
      ? { dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00Z`) : null }
      : {}),
    ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    ...(input.dietaryPreference !== undefined
      ? { dietaryPreference: input.dietaryPreference }
      : {}),
    ...(input.allergies !== undefined ? { allergies: input.allergies } : {}),
    ...(input.foodPreferences !== undefined ? { foodPreferences: input.foodPreferences } : {}),
    ...(input.defaultCheckpointId !== undefined
      ? { defaultCheckpointId: input.defaultCheckpointId }
      : {}),
    ...(input.defaultTimeSlotId !== undefined
      ? { defaultTimeSlotId: input.defaultTimeSlotId }
      : {}),
    ...(input.cityId !== undefined ? { cityId: input.cityId } : {}),
    ...(input.emergencyContactName !== undefined
      ? { emergencyContactName: input.emergencyContactName }
      : {}),
    ...(input.emergencyContactPhone !== undefined
      ? { emergencyContactPhone: input.emergencyContactPhone }
      : {}),
    ...(input.emergencyContactRelation !== undefined
      ? { emergencyContactRelation: input.emergencyContactRelation }
      : {}),
  };

  const updated = await prisma.$transaction(async (tx) => {
    if (Object.keys(userData).length > 0) {
      await tx.user.update({ where: { id: userId }, data: userData });
    }
    if (Object.keys(profileData).length > 0) {
      // Upsert: accounts created before the profile row existed still work.
      await tx.userProfile.upsert({
        where: { userId },
        update: profileData,
        create: { userId, ...profileData },
      });
    }
    return tx.user.findFirstOrThrow({ where: { id: userId }, include: profileInclude });
  });

  logger.info({ userId }, 'Profile updated');
  return toCustomerProfile(updated);
}
