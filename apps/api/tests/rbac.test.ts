/**
 * Role-based access control.
 *
 * Proves the guarantee Module 2 is really about: a role cannot reach another
 * role's API. The matrix test is the important one — it asserts the *whole*
 * grid rather than a handful of happy paths, so adding a role or a surface
 * without thinking about access fails here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, UserRole, UserStatus } from '@lunch/shared';
import { prisma } from '../src/core/prisma';
import { api, cleanupTestUsers, disconnect, registerUser, uniqueEmail, VALID_PASSWORD } from './helpers';

/** Seeded accounts, one per role. Created by `npm run db:seed`. */
const SEEDED = {
  CUSTOMER: 'customer@lunch.test',
  PARENT: 'parent@lunch.test',
  STUDENT: 'student@lunch.test',
  VENDOR: 'vendor@lunch.test',
  DELIVERY_PARTNER: 'rider@lunch.test',
  INSTITUTION_ADMIN: 'institution@lunch.test',
  SUPER_ADMIN: 'admin@lunch.test',
} as const satisfies Record<UserRole, string>;

const SEED_PASSWORD = 'Lunch@1234';

const tokens = new Map<UserRole, string>();

async function signIn(email: string): Promise<string> {
  const res = await api()
    .post('/api/v1/auth/login')
    .send({ identifier: email, password: SEED_PASSWORD })
    .expect(200);
  return res.body.data.tokens.accessToken as string;
}

beforeAll(async () => {
  await cleanupTestUsers();
  for (const [role, email] of Object.entries(SEEDED) as [UserRole, string][]) {
    tokens.set(role, await signIn(email));
  }
});

afterAll(async () => {
  await cleanupTestUsers();
  await disconnect();
});

const auth = (role: UserRole) => `Bearer ${tokens.get(role)}`;

/** Each guarded surface and the roles permitted to reach it. */
const SURFACES = [
  { name: 'admin', path: '/api/v1/admin/users', allowed: [UserRole.SUPER_ADMIN] },
  { name: 'vendor', path: '/api/v1/vendor/profile', allowed: [UserRole.VENDOR, UserRole.SUPER_ADMIN] },
  {
    name: 'delivery',
    path: '/api/v1/delivery/profile',
    allowed: [UserRole.DELIVERY_PARTNER, UserRole.SUPER_ADMIN],
  },
] as const;

const ALL_ROLES = Object.keys(SEEDED) as UserRole[];

describe('role × surface access matrix', () => {
  for (const surface of SURFACES) {
    for (const role of ALL_ROLES) {
      const permitted = (surface.allowed as readonly UserRole[]).includes(role);

      it(`${permitted ? 'allows' : 'denies'} ${role} on the ${surface.name} API`, async () => {
        const res = await api().get(surface.path).set('Authorization', auth(role));

        if (permitted) {
          // SUPER_ADMIN passes the guard on the vendor/delivery surfaces but has
          // no vendor or rider record of its own, so a 404 is also a pass: it
          // proves authorization succeeded and the handler ran.
          expect([200, 404]).toContain(res.status);
        } else {
          expect(res.status).toBe(403);
          expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
        }
      });
    }
  }
});

describe('the scenarios named in the requirements', () => {
  it('CUSTOMER cannot access vendor APIs', async () => {
    const res = await api()
      .get('/api/v1/vendor/profile')
      .set('Authorization', auth(UserRole.CUSTOMER))
      .expect(403);
    expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('VENDOR cannot access admin APIs', async () => {
    await api()
      .get('/api/v1/admin/users')
      .set('Authorization', auth(UserRole.VENDOR))
      .expect(403);
  });

  it('DELIVERY_PARTNER cannot reach admin APIs or change account status', async () => {
    await api()
      .get('/api/v1/admin/users')
      .set('Authorization', auth(UserRole.DELIVERY_PARTNER))
      .expect(403);

    const victim = await registerUser();
    await api()
      .patch(`/api/v1/admin/users/${victim.id}/status`)
      .set('Authorization', auth(UserRole.DELIVERY_PARTNER))
      .send({ status: UserStatus.SUSPENDED })
      .expect(403);

    // The target is untouched.
    const row = await prisma.user.findUnique({
      where: { id: victim.id },
      select: { status: true },
    });
    expect(row?.status).toBe(UserStatus.ACTIVE);
  });

  it('SUPER_ADMIN has administrative access', async () => {
    const res = await api()
      .get('/api/v1/admin/users')
      .set('Authorization', auth(UserRole.SUPER_ADMIN))
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.total).toBeGreaterThan(0);
  });
});

describe('guards reject unauthenticated and malformed credentials', () => {
  for (const surface of SURFACES) {
    it(`rejects an anonymous request to the ${surface.name} API`, async () => {
      const res = await api().get(surface.path).expect(401);
      expect(res.body.error.code).toBe(ErrorCode.UNAUTHENTICATED);
    });

    it(`rejects a forged token on the ${surface.name} API`, async () => {
      const res = await api()
        .get(surface.path)
        .set('Authorization', 'Bearer not.a.real.token')
        .expect(401);
      expect(res.body.error.code).toBe(ErrorCode.TOKEN_INVALID);
    });
  }

  it('a token signed with the wrong secret is rejected', async () => {
    // Structurally valid JWT, wrong signature.
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4Iiwicm9sZSI6IlNVUEVSX0FETUlOIn0.' +
      'ZmFrZXNpZ25hdHVyZQ';
    await api().get('/api/v1/admin/users').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it('a user cannot escalate their own role by claiming it at sign-up', async () => {
    await api()
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Escalation Attempt',
        email: uniqueEmail('escalate'),
        password: VALID_PASSWORD,
        role: UserRole.SUPER_ADMIN,
      })
      .expect(422);
  });

  it('a role change takes effect without waiting for the token to expire', async () => {
    const user = await registerUser();

    await api()
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(403);

    // Promote directly in the database; the old access token still says CUSTOMER.
    await prisma.user.update({
      where: { id: user.id },
      data: { role: UserRole.SUPER_ADMIN },
    });

    // `authenticate` re-reads the role, so the same token now passes.
    await api()
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
  });
});

describe('admin user administration', () => {
  it('lists users with pagination metadata', async () => {
    const res = await api()
      .get('/api/v1/admin/users?page=1&pageSize=5')
      .set('Authorization', auth(UserRole.SUPER_ADMIN))
      .expect(200);

    expect(res.body.data.length).toBeLessThanOrEqual(5);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 5 });
    // The list must never carry credentials.
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('filters by role', async () => {
    const res = await api()
      .get(`/api/v1/admin/users?role=${UserRole.VENDOR}`)
      .set('Authorization', auth(UserRole.SUPER_ADMIN))
      .expect(200);

    expect(res.body.data.length).toBeGreaterThan(0);
    for (const user of res.body.data) expect(user.role).toBe(UserRole.VENDOR);
  });

  it('suspends an account, ends its sessions and blocks its token', async () => {
    const victim = await registerUser();

    await api()
      .patch(`/api/v1/admin/users/${victim.id}/status`)
      .set('Authorization', auth(UserRole.SUPER_ADMIN))
      .send({ status: UserStatus.SUSPENDED, reason: 'Payment fraud investigation' })
      .expect(200);

    // Their existing access token stops working immediately.
    const blocked = await api()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${victim.accessToken}`)
      .expect(403);
    expect(blocked.body.error.code).toBe(ErrorCode.ACCOUNT_SUSPENDED);

    // Their refresh token was revoked, so they cannot mint a new one.
    await api().post('/api/v1/auth/refresh').send({ refreshToken: victim.refreshToken }).expect(401);

    // And they cannot sign back in.
    await api()
      .post('/api/v1/auth/login')
      .send({ identifier: victim.email, password: victim.password })
      .expect(403);
  });

  it('reactivating an account restores sign-in', async () => {
    const victim = await registerUser();

    await api()
      .patch(`/api/v1/admin/users/${victim.id}/status`)
      .set('Authorization', auth(UserRole.SUPER_ADMIN))
      .send({ status: UserStatus.SUSPENDED })
      .expect(200);

    await api()
      .patch(`/api/v1/admin/users/${victim.id}/status`)
      .set('Authorization', auth(UserRole.SUPER_ADMIN))
      .send({ status: UserStatus.ACTIVE })
      .expect(200);

    await api()
      .post('/api/v1/auth/login')
      .send({ identifier: victim.email, password: victim.password })
      .expect(200);
  });

  it('records a status change in the audit log', async () => {
    const victim = await registerUser();

    await api()
      .patch(`/api/v1/admin/users/${victim.id}/status`)
      .set('Authorization', auth(UserRole.SUPER_ADMIN))
      .send({ status: UserStatus.SUSPENDED, reason: 'Abuse report' })
      .expect(200);

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: 'User', entityId: victim.id, action: 'user.status.updated' },
      orderBy: { createdAt: 'desc' },
    });

    expect(entry).not.toBeNull();
    expect(entry?.after).toMatchObject({ status: UserStatus.SUSPENDED, reason: 'Abuse report' });
  });

  it('refuses to let an admin suspend themselves', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: SEEDED.SUPER_ADMIN },
      select: { id: true },
    });

    const res = await api()
      .patch(`/api/v1/admin/users/${admin.id}/status`)
      .set('Authorization', auth(UserRole.SUPER_ADMIN))
      .send({ status: UserStatus.SUSPENDED })
      .expect(400);

    expect(res.body.error.message).toMatch(/your own account/i);
  });

  it('returns 404 for an unknown user', async () => {
    await api()
      .get('/api/v1/admin/users/clnonexistentuserid000')
      .set('Authorization', auth(UserRole.SUPER_ADMIN))
      .expect(404);
  });

  it('rejects an invalid status value', async () => {
    const victim = await registerUser();
    const res = await api()
      .patch(`/api/v1/admin/users/${victim.id}/status`)
      .set('Authorization', auth(UserRole.SUPER_ADMIN))
      .send({ status: 'BANNED' })
      .expect(422);
    expect(res.body.error.details.status).toBeDefined();
  });
});

describe('role-scoped resources', () => {
  it('returns the vendor’s own profile', async () => {
    const res = await api()
      .get('/api/v1/vendor/profile')
      .set('Authorization', auth(UserRole.VENDOR))
      .expect(200);

    expect(res.body.data.vendor.businessName).toBeTypeOf('string');
    // Kitchens are returned alongside the vendor, not nested inside it.
    expect(Array.isArray(res.body.data.kitchens)).toBe(true);
  });

  it('returns the delivery partner’s own profile', async () => {
    const res = await api()
      .get('/api/v1/delivery/profile')
      .set('Authorization', auth(UserRole.DELIVERY_PARTNER))
      .expect(200);

    expect(res.body.data.deliveryPartner.vehicleNumber).toBeTypeOf('string');
  });
});
