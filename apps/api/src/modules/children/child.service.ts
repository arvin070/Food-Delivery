/**
 * Child management.
 *
 * Authorization rule, and the reason this file reads the way it does: **every
 * query is scoped by `parentId` in its `where` clause.** We never fetch a child
 * by id and then compare owners afterwards — a scoped query cannot leak a row
 * through a forgotten check, and another parent's child comes back as "not
 * found" rather than "forbidden", so the endpoint does not confirm that some
 * other family's record exists.
 *
 * A child is a record, not an account. `studentUserId` is set only if the child
 * is later given their own STUDENT login; nothing here requires one.
 */
import type { Prisma } from '@prisma/client';
import type { Child, CreateChildInput, DietaryPreference, UpdateChildInput } from '@lunch/shared';
import { badRequest, notFound } from '../../core/errors';
import { logger } from '../../core/logger';
import { prisma } from '../../core/prisma';

/** Related records a child is displayed with. */
const childSelect = {
  id: true,
  fullName: true,
  dateOfBirth: true,
  grade: true,
  section: true,
  rollNumber: true,
  dietaryPreference: true,
  allergies: true,
  foodPreferences: true,
  notes: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyContactRelation: true,
  studentUserId: true,
  isActive: true,
  createdAt: true,
  institution: { select: { id: true, name: true } },
  defaultCheckpoint: { select: { id: true, name: true } },
  defaultTimeSlot: { select: { id: true, label: true } },
} satisfies Prisma.ChildSelect;

type ChildRow = Prisma.ChildGetPayload<{ select: typeof childSelect }>;

/** Whole years elapsed, or null when no date of birth is recorded. */
function ageFrom(dateOfBirth: Date | null): number | null {
  if (!dateOfBirth) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) age -= 1;
  return Math.max(0, age);
}

function toChild(row: ChildRow): Child {
  return {
    id: row.id,
    fullName: row.fullName,
    dateOfBirth: row.dateOfBirth ? row.dateOfBirth.toISOString().slice(0, 10) : null,
    age: ageFrom(row.dateOfBirth),
    institution: row.institution ? { id: row.institution.id, name: row.institution.name } : null,
    grade: row.grade,
    section: row.section,
    rollNumber: row.rollNumber,
    defaultCheckpoint: row.defaultCheckpoint
      ? { id: row.defaultCheckpoint.id, name: row.defaultCheckpoint.name }
      : null,
    defaultTimeSlot: row.defaultTimeSlot
      ? { id: row.defaultTimeSlot.id, name: row.defaultTimeSlot.label }
      : null,
    dietaryPreference: row.dietaryPreference as DietaryPreference,
    allergies: row.allergies,
    foodPreferences: row.foodPreferences,
    notes: row.notes,
    emergencyContactName: row.emergencyContactName,
    emergencyContactPhone: row.emergencyContactPhone,
    emergencyContactRelation: row.emergencyContactRelation,
    hasOwnLogin: Boolean(row.studentUserId),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

function dateOrNull(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(`${value}T00:00:00Z`);
}

/**
 * Confirms that referenced records exist and are usable before writing.
 *
 * Prisma would reject a bad foreign key anyway, but with a generic message that
 * does not say which field was wrong. Checking here produces a field-level
 * error the form can display next to the offending input.
 */
async function assertReferencesExist(input: {
  institutionId?: string | null | undefined;
  defaultCheckpointId?: string | null | undefined;
  defaultTimeSlotId?: string | null | undefined;
}): Promise<void> {
  const details: Record<string, string[]> = {};

  if (input.institutionId) {
    const found = await prisma.institution.count({
      where: { id: input.institutionId, isActive: true },
    });
    if (!found) details['institutionId'] = ['That institution was not found'];
  }

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

  if (Object.keys(details).length > 0) {
    throw badRequest('Some of the selected options are no longer available', details);
  }
}

export async function listChildren(parentId: string): Promise<Child[]> {
  const rows = await prisma.child.findMany({
    where: { parentId, deletedAt: null },
    select: childSelect,
    orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
  });
  return rows.map(toChild);
}

export async function getChild(parentId: string, childId: string): Promise<Child> {
  const row = await prisma.child.findFirst({
    // Scoped by parentId: another parent's child is simply not found.
    where: { id: childId, parentId, deletedAt: null },
    select: childSelect,
  });
  if (!row) throw notFound('Child');
  return toChild(row);
}

export async function createChild(parentId: string, input: CreateChildInput): Promise<Child> {
  await assertReferencesExist(input);

  // Two children with the same name in one family is almost always a
  // double-submit rather than twins registered identically.
  const duplicate = await prisma.child.findFirst({
    where: {
      parentId,
      deletedAt: null,
      fullName: { equals: input.fullName, mode: 'insensitive' },
    },
    select: { id: true },
  });
  if (duplicate) {
    throw badRequest('You already have a child with that name', {
      fullName: ['A child with this name already exists on your account'],
    });
  }

  const row = await prisma.child.create({
    data: {
      parentId,
      fullName: input.fullName,
      dateOfBirth: dateOrNull(input.dateOfBirth) ?? null,
      institutionId: input.institutionId ?? null,
      grade: input.grade ?? null,
      section: input.section ?? null,
      rollNumber: input.rollNumber ?? null,
      defaultCheckpointId: input.defaultCheckpointId ?? null,
      defaultTimeSlotId: input.defaultTimeSlotId ?? null,
      dietaryPreference: input.dietaryPreference,
      allergies: input.allergies ?? null,
      foodPreferences: input.foodPreferences ?? [],
      notes: input.notes ?? null,
      emergencyContactName: input.emergencyContactName ?? null,
      emergencyContactPhone: input.emergencyContactPhone ?? null,
      emergencyContactRelation: input.emergencyContactRelation ?? null,
    },
    select: childSelect,
  });

  logger.info({ parentId, childId: row.id }, 'Child added');
  return toChild(row);
}

export async function updateChild(
  parentId: string,
  childId: string,
  input: UpdateChildInput
): Promise<Child> {
  // Establishes ownership before any write.
  const existing = await prisma.child.findFirst({
    where: { id: childId, parentId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw notFound('Child');

  await assertReferencesExist(input);

  if (input.fullName) {
    const duplicate = await prisma.child.findFirst({
      where: {
        parentId,
        deletedAt: null,
        id: { not: childId },
        fullName: { equals: input.fullName, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw badRequest('You already have a child with that name', {
        fullName: ['A child with this name already exists on your account'],
      });
    }
  }

  // Only the keys actually sent are written, so a partial update cannot blank
  // a field the form did not include.
  const data: Prisma.ChildUpdateInput = {};
  if (input.fullName !== undefined) data.fullName = input.fullName;
  if (input.dateOfBirth !== undefined) data.dateOfBirth = dateOrNull(input.dateOfBirth);
  if (input.grade !== undefined) data.grade = input.grade;
  if (input.section !== undefined) data.section = input.section;
  if (input.rollNumber !== undefined) data.rollNumber = input.rollNumber;
  if (input.dietaryPreference !== undefined) data.dietaryPreference = input.dietaryPreference;
  if (input.allergies !== undefined) data.allergies = input.allergies;
  if (input.foodPreferences !== undefined) data.foodPreferences = input.foodPreferences;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.emergencyContactName !== undefined) {
    data.emergencyContactName = input.emergencyContactName;
  }
  if (input.emergencyContactPhone !== undefined) {
    data.emergencyContactPhone = input.emergencyContactPhone;
  }
  if (input.emergencyContactRelation !== undefined) {
    data.emergencyContactRelation = input.emergencyContactRelation;
  }
  // Relations are set through their connect/disconnect form.
  if (input.institutionId !== undefined) {
    data.institution = input.institutionId
      ? { connect: { id: input.institutionId } }
      : { disconnect: true };
  }
  if (input.defaultCheckpointId !== undefined) {
    data.defaultCheckpoint = input.defaultCheckpointId
      ? { connect: { id: input.defaultCheckpointId } }
      : { disconnect: true };
  }
  if (input.defaultTimeSlotId !== undefined) {
    data.defaultTimeSlot = input.defaultTimeSlotId
      ? { connect: { id: input.defaultTimeSlotId } }
      : { disconnect: true };
  }

  const row = await prisma.child.update({
    where: { id: childId },
    data,
    select: childSelect,
  });

  logger.info({ parentId, childId }, 'Child updated');
  return toChild(row);
}

/**
 * Removes a child.
 *
 * Soft delete, always: order items reference the child, and a parent removing a
 * child who left school must not erase the delivery history of meals already
 * paid for. The record stops appearing everywhere the parent looks.
 */
export async function removeChild(parentId: string, childId: string): Promise<void> {
  const existing = await prisma.child.findFirst({
    where: { id: childId, parentId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw notFound('Child');

  // A child with meals already scheduled should not vanish mid-flight.
  const upcoming = await prisma.orderItem.count({
    where: {
      childId,
      status: { in: ['PENDING', 'CONFIRMED', 'PREPARING', 'PACKED', 'DISPATCHED', 'OUT_FOR_DELIVERY'] },
    },
  });
  if (upcoming > 0) {
    throw badRequest(
      `This child has ${upcoming} meal${upcoming === 1 ? '' : 's'} still to be delivered. Cancel them first.`
    );
  }

  await prisma.child.update({
    where: { id: childId },
    data: { deletedAt: new Date(), isActive: false },
  });

  logger.info({ parentId, childId }, 'Child removed');
}
