/**
 * Child management, and the isolation guarantee that matters most here: one
 * parent must never reach another parent's children.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, UserRole } from '@lunch/shared';
import { prisma } from '../src/core/prisma';
import { api, cleanupTestUsers, disconnect, registerUser, type RegisteredUser } from './helpers';

const BASE = '/api/v1/children';

let parentA: RegisteredUser;
let parentB: RegisteredUser;

/** Reference ids from the seed, used to exercise the relation fields. */
let institutionId: string;
let checkpointId: string;
let timeSlotId: string;

const authOf = (u: RegisteredUser) => `Bearer ${u.accessToken}`;

async function addChild(
  owner: RegisteredUser,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const res = await api()
    .post(BASE)
    .set('Authorization', authOf(owner))
    .send({ fullName: `Child ${Math.random().toString(36).slice(2, 8)}`, ...overrides })
    .expect(201);
  return res.body.data.child.id as string;
}

beforeAll(async () => {
  await cleanupTestUsers();

  parentA = await registerUser({ role: UserRole.PARENT });
  parentB = await registerUser({ role: UserRole.PARENT });

  const [institution, checkpoint, timeSlot] = await Promise.all([
    prisma.institution.findFirstOrThrow({ select: { id: true } }),
    prisma.checkpoint.findFirstOrThrow({ where: { isActive: true }, select: { id: true } }),
    prisma.timeSlot.findFirstOrThrow({ where: { isActive: true }, select: { id: true } }),
  ]);
  institutionId = institution.id;
  checkpointId = checkpoint.id;
  timeSlotId = timeSlot.id;
});

afterAll(async () => {
  await cleanupTestUsers();
  await disconnect();
});

describe('a parent manages multiple children', () => {
  it('adds three children and lists them all', async () => {
    const parent = await registerUser({ role: UserRole.PARENT });

    for (const name of ['Arjun Narayanan', 'Ananya Narayanan', 'Aditya Narayanan']) {
      await api()
        .post(BASE)
        .set('Authorization', authOf(parent))
        .send({ fullName: name })
        .expect(201);
    }

    const res = await api().get(BASE).set('Authorization', authOf(parent)).expect(200);

    expect(res.body.data.children).toHaveLength(3);
    expect(res.body.data.children.map((c: { fullName: string }) => c.fullName)).toEqual([
      'Aditya Narayanan',
      'Ananya Narayanan',
      'Arjun Narayanan',
    ]);
  });

  it('creates a child with no account of their own', async () => {
    const childId = await addChild(parentA, { fullName: 'No Account Child' });

    const row = await prisma.child.findUniqueOrThrow({
      where: { id: childId },
      select: { studentUserId: true, parentId: true },
    });
    expect(row.studentUserId).toBeNull();
    expect(row.parentId).toBe(parentA.id);

    const res = await api().get(`${BASE}/${childId}`).set('Authorization', authOf(parentA)).expect(200);
    expect(res.body.data.child.hasOwnLogin).toBe(false);
  });

  it('stores every documented field', async () => {
    const res = await api()
      .post(BASE)
      .set('Authorization', authOf(parentA))
      .send({
        fullName: 'Fully Described Child',
        dateOfBirth: '2014-05-20',
        institutionId,
        grade: 'Grade 7',
        section: 'B',
        rollNumber: 'SPS-2014-118',
        defaultCheckpointId: checkpointId,
        defaultTimeSlotId: timeSlotId,
        dietaryPreference: 'VEGETARIAN',
        allergies: 'Peanuts, shellfish',
        foodPreferences: ['South Indian', 'mild'],
        notes: 'Hand over to the duty teacher only.',
        emergencyContactName: 'Lakshmi Narayanan',
        emergencyContactPhone: '+919000012345',
        emergencyContactRelation: 'Mother',
      })
      .expect(201);

    const child = res.body.data.child;
    expect(child).toMatchObject({
      fullName: 'Fully Described Child',
      dateOfBirth: '2014-05-20',
      grade: 'Grade 7',
      section: 'B',
      rollNumber: 'SPS-2014-118',
      dietaryPreference: 'VEGETARIAN',
      allergies: 'Peanuts, shellfish',
      emergencyContactRelation: 'Mother',
    });
    expect(child.institution.id).toBe(institutionId);
    expect(child.defaultCheckpoint.id).toBe(checkpointId);
    expect(child.defaultTimeSlot.id).toBe(timeSlotId);
    // Food preferences are normalised to lowercase and de-duplicated.
    expect(child.foodPreferences).toEqual(['south indian', 'mild']);
  });

  it('derives age from the date of birth', async () => {
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 11);
    dob.setUTCDate(dob.getUTCDate() - 1); // safely past the birthday

    const res = await api()
      .post(BASE)
      .set('Authorization', authOf(parentA))
      .send({ fullName: 'Age Check Child', dateOfBirth: dob.toISOString().slice(0, 10) })
      .expect(201);

    expect(res.body.data.child.age).toBe(11);
  });

  it('reports a null age when no date of birth is given', async () => {
    const childId = await addChild(parentA, { fullName: 'Ageless Child' });
    const res = await api().get(`${BASE}/${childId}`).set('Authorization', authOf(parentA)).expect(200);
    expect(res.body.data.child.age).toBeNull();
    expect(res.body.data.child.dateOfBirth).toBeNull();
  });
});

describe('one parent cannot reach another parent’s children', () => {
  it('does not list them', async () => {
    const a = await registerUser({ role: UserRole.PARENT });
    const b = await registerUser({ role: UserRole.PARENT });
    await addChild(a, { fullName: 'A Child' });

    const res = await api().get(BASE).set('Authorization', authOf(b)).expect(200);
    expect(res.body.data.children).toHaveLength(0);
  });

  it('cannot read one by id', async () => {
    const childId = await addChild(parentA, { fullName: 'Private Child Read' });

    const res = await api()
      .get(`${BASE}/${childId}`)
      .set('Authorization', authOf(parentB))
      .expect(404);
    // 404, not 403: the response must not confirm the record exists.
    expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('cannot update one', async () => {
    const childId = await addChild(parentA, { fullName: 'Private Child Update' });

    await api()
      .patch(`${BASE}/${childId}`)
      .set('Authorization', authOf(parentB))
      .send({ fullName: 'Hijacked' })
      .expect(404);

    const row = await prisma.child.findUniqueOrThrow({ where: { id: childId } });
    expect(row.fullName).toBe('Private Child Update');
  });

  it('cannot delete one', async () => {
    const childId = await addChild(parentA, { fullName: 'Private Child Delete' });

    await api()
      .delete(`${BASE}/${childId}`)
      .set('Authorization', authOf(parentB))
      .expect(404);

    const row = await prisma.child.findUniqueOrThrow({ where: { id: childId } });
    expect(row.deletedAt).toBeNull();
  });

  it('cannot reassign a child by sending another parent’s id', async () => {
    const childId = await addChild(parentA, { fullName: 'Reassign Attempt' });

    // parentId is not part of the update schema, so it is ignored outright.
    await api()
      .patch(`${BASE}/${childId}`)
      .set('Authorization', authOf(parentA))
      .send({ fullName: 'Renamed', parentId: parentB.id })
      .expect(200);

    const row = await prisma.child.findUniqueOrThrow({ where: { id: childId } });
    expect(row.parentId).toBe(parentA.id);
  });
});

describe('role authorization on the children surface', () => {
  it('rejects an anonymous request', async () => {
    await api().get(BASE).expect(401);
  });

  it('allows PARENT and CUSTOMER', async () => {
    const customer = await registerUser({ role: UserRole.CUSTOMER });
    await api().get(BASE).set('Authorization', authOf(customer)).expect(200);
    await api().get(BASE).set('Authorization', authOf(parentA)).expect(200);
  });

  it('denies VENDOR, DELIVERY_PARTNER and STUDENT', async () => {
    for (const role of [UserRole.VENDOR, UserRole.DELIVERY_PARTNER, UserRole.STUDENT]) {
      const user = await registerUser({ role: UserRole.CUSTOMER });
      await prisma.user.update({ where: { id: user.id }, data: { role } });

      const res = await api().get(BASE).set('Authorization', authOf(user)).expect(403);
      expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
    }
  });
});

describe('validation', () => {
  it('requires a name', async () => {
    const res = await api().post(BASE).set('Authorization', authOf(parentA)).send({}).expect(422);
    expect(res.body.error.details.fullName).toBeDefined();
  });

  it('rejects a future date of birth', async () => {
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 1);

    const res = await api()
      .post(BASE)
      .set('Authorization', authOf(parentA))
      .send({ fullName: 'Future Child', dateOfBirth: future.toISOString().slice(0, 10) })
      .expect(422);
    expect(res.body.error.details.dateOfBirth).toBeDefined();
  });

  it('rejects an implausible date of birth', async () => {
    const res = await api()
      .post(BASE)
      .set('Authorization', authOf(parentA))
      .send({ fullName: 'Ancient Child', dateOfBirth: '1902-01-01' })
      .expect(422);
    expect(res.body.error.details.dateOfBirth).toBeDefined();
  });

  it('rejects a half-filled emergency contact', async () => {
    const res = await api()
      .post(BASE)
      .set('Authorization', authOf(parentA))
      .send({ fullName: 'Half Contact Child', emergencyContactName: 'Someone' })
      .expect(422);
    expect(res.body.error.details.emergencyContactPhone).toBeDefined();
  });

  it('accepts a complete emergency contact', async () => {
    await api()
      .post(BASE)
      .set('Authorization', authOf(parentA))
      .send({
        fullName: 'Full Contact Child',
        emergencyContactName: 'Guardian Person',
        emergencyContactPhone: '+919000054321',
      })
      .expect(201);
  });

  it('rejects an unknown institution with a field-level error', async () => {
    const res = await api()
      .post(BASE)
      .set('Authorization', authOf(parentA))
      .send({ fullName: 'Bad Institution Child', institutionId: 'clnonexistent000000000' })
      .expect(400);
    expect(res.body.error.details.institutionId).toBeDefined();
  });

  it('rejects an unknown checkpoint and time slot', async () => {
    const res = await api()
      .post(BASE)
      .set('Authorization', authOf(parentA))
      .send({
        fullName: 'Bad Refs Child',
        defaultCheckpointId: 'clnonexistent000000000',
        defaultTimeSlotId: 'clnonexistent000000001',
      })
      .expect(400);
    expect(res.body.error.details.defaultCheckpointId).toBeDefined();
    expect(res.body.error.details.defaultTimeSlotId).toBeDefined();
  });

  it('refuses a duplicate name within the same family', async () => {
    const parent = await registerUser({ role: UserRole.PARENT });
    await addChild(parent, { fullName: 'Repeated Name' });

    const res = await api()
      .post(BASE)
      .set('Authorization', authOf(parent))
      .send({ fullName: 'repeated name' })
      .expect(400);
    expect(res.body.error.details.fullName).toBeDefined();
  });

  it('allows the same child name across different families', async () => {
    const a = await registerUser({ role: UserRole.PARENT });
    const b = await registerUser({ role: UserRole.PARENT });
    await addChild(a, { fullName: 'Common Name' });
    await addChild(b, { fullName: 'Common Name' });
  });
});

describe('editing a child', () => {
  it('updates only the fields sent', async () => {
    const childId = await addChild(parentA, {
      fullName: 'Partial Update Child',
      grade: 'Grade 5',
      allergies: 'Dairy',
    });

    const res = await api()
      .patch(`${BASE}/${childId}`)
      .set('Authorization', authOf(parentA))
      .send({ grade: 'Grade 6' })
      .expect(200);

    expect(res.body.data.child.grade).toBe('Grade 6');
    // Untouched fields survive.
    expect(res.body.data.child.allergies).toBe('Dairy');
    expect(res.body.data.child.fullName).toBe('Partial Update Child');
  });

  it('clears a field when null is sent explicitly', async () => {
    const childId = await addChild(parentA, { fullName: 'Clearable Child', allergies: 'Gluten' });

    const res = await api()
      .patch(`${BASE}/${childId}`)
      .set('Authorization', authOf(parentA))
      .send({ allergies: null })
      .expect(200);

    expect(res.body.data.child.allergies).toBeNull();
  });

  it('detaches a default checkpoint when set to null', async () => {
    const childId = await addChild(parentA, {
      fullName: 'Detach Checkpoint Child',
      defaultCheckpointId: checkpointId,
    });

    const res = await api()
      .patch(`${BASE}/${childId}`)
      .set('Authorization', authOf(parentA))
      .send({ defaultCheckpointId: null })
      .expect(200);

    expect(res.body.data.child.defaultCheckpoint).toBeNull();
  });

  it('returns 404 for an unknown child', async () => {
    await api()
      .patch(`${BASE}/clnonexistent000000000`)
      .set('Authorization', authOf(parentA))
      .send({ fullName: 'Nobody' })
      .expect(404);
  });
});

describe('removing a child', () => {
  it('soft-deletes so delivery history survives', async () => {
    const childId = await addChild(parentA, { fullName: 'Soft Delete Child' });

    await api().delete(`${BASE}/${childId}`).set('Authorization', authOf(parentA)).expect(204);

    // Gone from the parent's view…
    await api().get(`${BASE}/${childId}`).set('Authorization', authOf(parentA)).expect(404);

    // …but the row is retained.
    const row = await prisma.child.findUnique({ where: { id: childId } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(row?.isActive).toBe(false);
  });

  it('drops the child from the list', async () => {
    const parent = await registerUser({ role: UserRole.PARENT });
    const keep = await addChild(parent, { fullName: 'Keeper Child' });
    const remove = await addChild(parent, { fullName: 'Removed Child' });

    await api().delete(`${BASE}/${remove}`).set('Authorization', authOf(parent)).expect(204);

    const res = await api().get(BASE).set('Authorization', authOf(parent)).expect(200);
    expect(res.body.data.children).toHaveLength(1);
    expect(res.body.data.children[0].id).toBe(keep);
  });

  it('frees the name for reuse after removal', async () => {
    const parent = await registerUser({ role: UserRole.PARENT });
    const childId = await addChild(parent, { fullName: 'Recycled Name' });
    await api().delete(`${BASE}/${childId}`).set('Authorization', authOf(parent)).expect(204);

    await api()
      .post(BASE)
      .set('Authorization', authOf(parent))
      .send({ fullName: 'Recycled Name' })
      .expect(201);
  });

  it('is idempotent in effect — a second delete is 404', async () => {
    const childId = await addChild(parentA, { fullName: 'Twice Deleted Child' });
    await api().delete(`${BASE}/${childId}`).set('Authorization', authOf(parentA)).expect(204);
    await api().delete(`${BASE}/${childId}`).set('Authorization', authOf(parentA)).expect(404);
  });

  it('refuses while meals are still to be delivered', async () => {
    const parent = await registerUser({ role: UserRole.PARENT });
    const childId = await addChild(parent, { fullName: 'Busy Child' });

    // Build a minimal confirmed order item against the seeded catalog.
    const schedule = await prisma.mealSchedule.findFirstOrThrow({
      where: { status: 'PUBLISHED' },
      include: { meal: true },
    });
    const order = await prisma.order.create({
      data: {
        orderNumber: `LN-TEST${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        customerId: parent.id,
        subtotal: '100.00',
        totalAmount: '100.00',
        status: 'CONFIRMED',
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        mealScheduleId: schedule.id,
        mealId: schedule.mealId,
        kitchenId: schedule.kitchenId,
        checkpointId,
        timeSlotId: schedule.timeSlotId,
        serviceDate: schedule.serviceDate,
        childId,
        beneficiaryName: 'Busy Child',
        mealNameSnapshot: schedule.meal.name,
        unitPrice: '100.00',
        quantity: 1,
        lineTotal: '100.00',
        status: 'CONFIRMED',
      },
    });

    const res = await api()
      .delete(`${BASE}/${childId}`)
      .set('Authorization', authOf(parent))
      .expect(400);
    expect(res.body.error.message).toMatch(/still to be delivered/i);

    // The child is untouched.
    const row = await prisma.child.findUniqueOrThrow({ where: { id: childId } });
    expect(row.deletedAt).toBeNull();

    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
  });
});

describe('children are selectable for ordering', () => {
  it('the list carries the defaults an order form needs', async () => {
    const parent = await registerUser({ role: UserRole.PARENT });
    await addChild(parent, {
      fullName: 'Orderable Child',
      defaultCheckpointId: checkpointId,
      defaultTimeSlotId: timeSlotId,
      dietaryPreference: 'VEGETARIAN',
      allergies: 'Peanuts',
    });

    const res = await api().get(BASE).set('Authorization', authOf(parent)).expect(200);
    const child = res.body.data.children[0];

    // Everything the order form pre-fills from, in one call.
    expect(child.defaultCheckpoint).toMatchObject({ id: checkpointId });
    expect(child.defaultTimeSlot).toMatchObject({ id: timeSlotId });
    expect(child.dietaryPreference).toBe('VEGETARIAN');
    expect(child.allergies).toBe('Peanuts');
  });
});
