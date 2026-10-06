import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, UserRole } from '@lunch/shared';
import { prisma } from '../src/core/prisma';
import {
  api,
  cleanupTestUsers,
  disconnect,
  registerUser,
  uniquePhone,
  VALID_PASSWORD,
  type RegisteredUser,
} from './helpers';

const BASE = '/api/v1/profile/me';
const authOf = (u: RegisteredUser) => `Bearer ${u.accessToken}`;

let checkpointId: string;
let timeSlotId: string;
let cityId: string;

beforeAll(async () => {
  await cleanupTestUsers();
  const [checkpoint, timeSlot, city] = await Promise.all([
    prisma.checkpoint.findFirstOrThrow({ where: { isActive: true }, select: { id: true } }),
    prisma.timeSlot.findFirstOrThrow({ where: { isActive: true }, select: { id: true } }),
    prisma.city.findFirstOrThrow({ where: { isActive: true }, select: { id: true } }),
  ]);
  checkpointId = checkpoint.id;
  timeSlotId = timeSlot.id;
  cityId = city.id;
});

afterAll(async () => {
  await cleanupTestUsers();
  await disconnect();
});

describe('GET /profile/me', () => {
  it('returns the signed-in user’s profile', async () => {
    const user = await registerUser({ fullName: 'Profile Owner' });
    const res = await api().get(BASE).set('Authorization', authOf(user)).expect(200);

    expect(res.body.data.profile).toMatchObject({
      userId: user.id,
      fullName: 'Profile Owner',
      email: user.email,
      childCount: 0,
    });
  });

  it('never exposes the password hash', async () => {
    const user = await registerUser();
    const res = await api().get(BASE).set('Authorization', authOf(user)).expect(200);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('requires authentication', async () => {
    const res = await api().get(BASE).expect(401);
    expect(res.body.error.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('counts the account’s children', async () => {
    const parent = await registerUser({ role: UserRole.PARENT });
    for (const name of ['One Child', 'Two Child']) {
      await api()
        .post('/api/v1/children')
        .set('Authorization', authOf(parent))
        .send({ fullName: name })
        .expect(201);
    }

    const res = await api().get(BASE).set('Authorization', authOf(parent)).expect(200);
    expect(res.body.data.profile.childCount).toBe(2);
  });

  it('has no route that takes another user’s id', async () => {
    const a = await registerUser();
    const b = await registerUser();
    // The only profile path is /me, so b's id is not addressable here.
    await api().get(`/api/v1/profile/${b.id}`).set('Authorization', authOf(a)).expect(404);
  });
});

describe('PATCH /profile/me', () => {
  it('updates identity and preference fields together', async () => {
    const user = await registerUser();

    const res = await api()
      .patch(BASE)
      .set('Authorization', authOf(user))
      .send({
        fullName: 'Updated Name',
        dateOfBirth: '1992-03-14',
        dietaryPreference: 'VEGETARIAN',
        allergies: 'Shellfish',
        foodPreferences: ['South Indian', 'Chettinad'],
        defaultCheckpointId: checkpointId,
        defaultTimeSlotId: timeSlotId,
        cityId,
        emergencyContactName: 'Next Of Kin',
        emergencyContactPhone: '+919000011122',
        emergencyContactRelation: 'Spouse',
      })
      .expect(200);

    const profile = res.body.data.profile;
    expect(profile).toMatchObject({
      fullName: 'Updated Name',
      dateOfBirth: '1992-03-14',
      dietaryPreference: 'VEGETARIAN',
      allergies: 'Shellfish',
      emergencyContactRelation: 'Spouse',
    });
    expect(profile.foodPreferences).toEqual(['south indian', 'chettinad']);
    expect(profile.defaultCheckpoint.id).toBe(checkpointId);
    expect(profile.defaultTimeSlot.id).toBe(timeSlotId);
    expect(profile.city.id).toBe(cityId);
  });

  it('updates only what is sent', async () => {
    const user = await registerUser({ fullName: 'Keep This Name' });
    await api()
      .patch(BASE)
      .set('Authorization', authOf(user))
      .send({ allergies: 'Dairy' })
      .expect(200);

    const res = await api()
      .patch(BASE)
      .set('Authorization', authOf(user))
      .send({ dietaryPreference: 'VEGAN' })
      .expect(200);

    expect(res.body.data.profile.fullName).toBe('Keep This Name');
    expect(res.body.data.profile.allergies).toBe('Dairy');
    expect(res.body.data.profile.dietaryPreference).toBe('VEGAN');
  });

  it('clears a field when null is sent', async () => {
    const user = await registerUser();
    await api()
      .patch(BASE)
      .set('Authorization', authOf(user))
      .send({ allergies: 'Nuts' })
      .expect(200);

    const res = await api()
      .patch(BASE)
      .set('Authorization', authOf(user))
      .send({ allergies: null })
      .expect(200);
    expect(res.body.data.profile.allergies).toBeNull();
  });

  it('resets verification when the email address changes', async () => {
    const user = await registerUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });

    const before = await api().get(BASE).set('Authorization', authOf(user)).expect(200);
    expect(before.body.data.profile.emailVerified).toBe(true);

    const res = await api()
      .patch(BASE)
      .set('Authorization', authOf(user))
      .send({ email: `changed-${Date.now()}@test.lunch` })
      .expect(200);

    // The new address has not been proven, so the flag must not carry over.
    expect(res.body.data.profile.emailVerified).toBe(false);
  });

  it('keeps verification when the email is resubmitted unchanged', async () => {
    const user = await registerUser();
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });

    const res = await api()
      .patch(BASE)
      .set('Authorization', authOf(user))
      .send({ email: user.email, fullName: 'Same Email' })
      .expect(200);

    expect(res.body.data.profile.emailVerified).toBe(true);
  });

  it('refuses an email already used by another account', async () => {
    const owner = await registerUser();
    const other = await registerUser();

    const res = await api()
      .patch(BASE)
      .set('Authorization', authOf(other))
      .send({ email: owner.email })
      .expect(409);
    expect(res.body.error.code).toBe(ErrorCode.EMAIL_TAKEN);
  });

  it('refuses a phone already used by another account', async () => {
    const phone = uniquePhone();
    const owner = await api()
      .post('/api/v1/auth/register')
      .send({ fullName: 'Phone Owner', phone, password: VALID_PASSWORD })
      .expect(201);

    const other = await registerUser();
    const res = await api()
      .patch(BASE)
      .set('Authorization', authOf(other))
      .send({ phone })
      .expect(409);
    expect(res.body.error.code).toBe(ErrorCode.PHONE_TAKEN);

    await prisma.user.delete({ where: { id: owner.body.data.user.id } });
  });

  it('refuses to leave an account with no way to sign in', async () => {
    const user = await registerUser(); // email only

    const res = await api()
      .patch(BASE)
      .set('Authorization', authOf(user))
      .send({ email: null })
      .expect(422);
    // `email: null` is not a valid email, so this is caught at validation.
    expect(res.body.error.details.email).toBeDefined();
  });

  it('rejects a half-filled emergency contact', async () => {
    const user = await registerUser();
    const res = await api()
      .patch(BASE)
      .set('Authorization', authOf(user))
      .send({ emergencyContactPhone: '+919000011133' })
      .expect(422);
    expect(res.body.error.details.emergencyContactPhone).toBeDefined();
  });

  it('rejects an invalid dietary preference', async () => {
    const user = await registerUser();
    const res = await api()
      .patch(BASE)
      .set('Authorization', authOf(user))
      .send({ dietaryPreference: 'CARNIVORE' })
      .expect(422);
    expect(res.body.error.details.dietaryPreference).toBeDefined();
  });

  it('rejects an unknown checkpoint with a field-level error', async () => {
    const user = await registerUser();
    const res = await api()
      .patch(BASE)
      .set('Authorization', authOf(user))
      .send({ defaultCheckpointId: 'clnonexistent000000000' })
      .expect(400);
    expect(res.body.error.details.defaultCheckpointId).toBeDefined();
  });

  it('rejects an avatar URL that is not a URL', async () => {
    const user = await registerUser();
    const res = await api()
      .patch(BASE)
      .set('Authorization', authOf(user))
      .send({ avatarUrl: 'not-a-url' })
      .expect(422);
    expect(res.body.error.details.avatarUrl).toBeDefined();
  });

  it('accepts an avatar URL', async () => {
    const user = await registerUser();
    const res = await api()
      .patch(BASE)
      .set('Authorization', authOf(user))
      .send({ avatarUrl: 'https://cdn.example.com/avatars/abc.png' })
      .expect(200);
    expect(res.body.data.profile.avatarUrl).toBe('https://cdn.example.com/avatars/abc.png');
  });

  it('cannot change another user’s profile', async () => {
    const a = await registerUser({ fullName: 'Owner A' });
    const b = await registerUser({ fullName: 'Owner B' });

    // userId is not in the schema, so it is stripped rather than honoured.
    await api()
      .patch(BASE)
      .set('Authorization', authOf(b))
      .send({ fullName: 'Changed By B', userId: a.id })
      .expect(200);

    const aRow = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(aRow.fullName).toBe('Owner A');
  });

  it('requires authentication', async () => {
    await api().patch(BASE).send({ fullName: 'Nobody' }).expect(401);
  });
});

describe('reference lookups', () => {
  it('returns the data the child and profile forms need', async () => {
    const user = await registerUser();
    const header = authOf(user);

    const cities = await api().get('/api/v1/reference/cities').set('Authorization', header).expect(200);
    expect(cities.body.data.cities.length).toBeGreaterThan(0);

    const institutions = await api()
      .get('/api/v1/reference/institutions')
      .set('Authorization', header)
      .expect(200);
    expect(institutions.body.data.institutions.length).toBeGreaterThan(0);

    const checkpoints = await api()
      .get('/api/v1/reference/checkpoints')
      .set('Authorization', header)
      .expect(200);
    expect(checkpoints.body.data.checkpoints.length).toBeGreaterThan(0);

    const slots = await api()
      .get('/api/v1/reference/time-slots')
      .set('Authorization', header)
      .expect(200);
    expect(slots.body.data.timeSlots.length).toBeGreaterThan(0);
  });

  it('filters checkpoints by institution', async () => {
    const user = await registerUser();
    const institution = await prisma.institution.findFirstOrThrow({
      where: { checkpoints: { some: {} } },
      select: { id: true },
    });

    const res = await api()
      .get(`/api/v1/reference/checkpoints?institutionId=${institution.id}`)
      .set('Authorization', authOf(user))
      .expect(200);

    expect(res.body.data.checkpoints.length).toBeGreaterThan(0);
    for (const cp of res.body.data.checkpoints) expect(cp.institutionId).toBe(institution.id);
  });

  it('requires authentication', async () => {
    await api().get('/api/v1/reference/checkpoints').expect(401);
  });
});
