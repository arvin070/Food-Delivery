import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UserRole } from '@lunch/shared';
import { prisma } from '../src/core/prisma';
import { api, disconnect } from './helpers';

const ADMIN_EMAIL = 'institution@lunch.test';
const ADMIN_PASSWORD = 'Lunch@1234';
const CHECKPOINT_NAME = 'Institution Admin Checkpoint Test';
let adminToken: string;
let checkpointId: string;
let unrelatedCheckpointId: string;
let unrelatedInactiveCheckpointId: string;

beforeAll(async () => {
  const login = await api()
    .post('/api/v1/auth/login')
    .send({ identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    .expect(200);
  adminToken = login.body.data.tokens.accessToken as string;

  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: ADMIN_EMAIL },
    select: { id: true },
  });
  const membership = await prisma.institutionMember.findFirstOrThrow({
    where: { userId: admin.id, role: 'ADMIN', isActive: true },
    select: { institution: { select: { id: true, cityId: true } } },
  });
  const unrelated = await prisma.checkpoint.findFirstOrThrow({
    where: { institutionId: { not: membership.institution.id } },
    select: { id: true, institutionId: true },
  });
  unrelatedCheckpointId = unrelated.id;

  const unrelatedInactive = await prisma.checkpoint.create({
    data: {
      name: 'Other Institution Inactive Checkpoint Test',
      type: 'COLLEGE_GATE',
      cityId: membership.institution.cityId,
      institutionId: unrelated.institutionId,
      isActive: false,
    },
    select: { id: true },
  });
  unrelatedInactiveCheckpointId = unrelatedInactive.id;

  const checkpoint = await prisma.checkpoint.create({
    data: {
      name: CHECKPOINT_NAME,
      type: 'COLLEGE_GATE',
      cityId: membership.institution.cityId,
      institutionId: membership.institution.id,
      isActive: false,
    },
    select: { id: true },
  });
  checkpointId = checkpoint.id;
});

afterAll(async () => {
  await prisma.checkpoint.deleteMany({
    where: { name: { in: [CHECKPOINT_NAME, 'Other Institution Inactive Checkpoint Test'] } },
  });
  await disconnect();
});

describe('institution-admin checkpoint management', () => {
  it('lists inactive checkpoints belonging to the administered institution', async () => {
    const res = await api()
      .get('/api/v1/checkpoints?isActive=false&q=Institution%20Admin%20Checkpoint%20Test')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: checkpointId, isActive: false }),
      ])
    );
  });

  it('can activate its own checkpoint but cannot change another institution checkpoint', async () => {
    await api()
      .patch(`/api/v1/checkpoints/${checkpointId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: true })
      .expect(200);

    const denied = await api()
      .patch(`/api/v1/checkpoints/${unrelatedCheckpointId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
  });

  it('does not expose another institution\'s inactive checkpoint detail', async () => {
    await api()
      .get(`/api/v1/checkpoints/${unrelatedInactiveCheckpointId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });
});