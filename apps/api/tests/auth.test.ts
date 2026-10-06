import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode } from '@lunch/shared';
import { prisma } from '../src/core/prisma';
import {
  api,
  cleanupTestUsers,
  disconnect,
  registerUser,
  uniqueEmail,
  uniquePhone,
  VALID_PASSWORD,
} from './helpers';

beforeAll(cleanupTestUsers);
afterAll(async () => {
  await cleanupTestUsers();
  await disconnect();
});

describe('POST /api/v1/auth/register', () => {
  it('creates a user and returns a session', async () => {
    const email = uniqueEmail('register');
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ fullName: 'Nila Raman', email, password: VALID_PASSWORD })
      .expect(201);

    expect(res.body.data.user).toMatchObject({ email, role: 'CUSTOMER', status: 'ACTIVE' });
    expect(res.body.data.tokens.accessToken).toBeTypeOf('string');
    expect(res.body.data.tokens.refreshToken).toBeTypeOf('string');
    // The password hash must never cross the wire.
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('creates the profile and wallet alongside the user', async () => {
    const user = await registerUser();
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      include: { profile: true, wallet: true },
    });
    expect(row?.profile).not.toBeNull();
    expect(row?.wallet).not.toBeNull();
  });

  it('sets httpOnly auth cookies', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ fullName: 'Cookie User', email: uniqueEmail('cookie'), password: VALID_PASSWORD })
      .expect(201);

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('lunch_access_token=') && c.includes('HttpOnly'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('lunch_refresh_token=') && c.includes('HttpOnly'))).toBe(true);
  });

  it('accepts registration with only a phone number', async () => {
    const phone = uniquePhone();
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ fullName: 'Phone Only', phone, password: VALID_PASSWORD })
      .expect(201);
    expect(res.body.data.user.phone).toBe(phone);
    // Clean up: this user has no @test.lunch email for the bulk cleanup to find.
    await prisma.user.delete({ where: { id: res.body.data.user.id } });
  });

  it('rejects registration with neither email nor phone', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ fullName: 'No Contact', password: VALID_PASSWORD })
      .expect(422);
    expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(res.body.error.details.email).toBeDefined();
  });

  it('rejects a weak password with field-level detail', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ fullName: 'Weak Pass', email: uniqueEmail('weak'), password: 'alllowercase' })
      .expect(422);
    expect(res.body.error.details.password.length).toBeGreaterThan(0);
  });

  it('rejects a duplicate email with EMAIL_TAKEN', async () => {
    const existing = await registerUser();
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ fullName: 'Duplicate', email: existing.email, password: VALID_PASSWORD })
      .expect(409);
    expect(res.body.error.code).toBe(ErrorCode.EMAIL_TAKEN);
  });

  it('refuses to self-register a privileged role', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Would-be Admin',
        email: uniqueEmail('admin'),
        password: VALID_PASSWORD,
        role: 'SUPER_ADMIN',
      })
      .expect(422);
    expect(res.body.error.details.role).toBeDefined();
  });

  it('allows PARENT and STUDENT self-registration', async () => {
    for (const role of ['PARENT', 'STUDENT']) {
      const res = await api()
        .post('/api/v1/auth/register')
        .send({ fullName: `A ${role}`, email: uniqueEmail(role.toLowerCase()), password: VALID_PASSWORD, role })
        .expect(201);
      expect(res.body.data.user.role).toBe(role);
    }
  });
});

describe('POST /api/v1/auth/login', () => {
  it('signs in with an email address', async () => {
    const user = await registerUser();
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: user.email, password: user.password })
      .expect(200);
    expect(res.body.data.user.id).toBe(user.id);
  });

  it('records lastLoginAt', async () => {
    const user = await registerUser();
    await api()
      .post('/api/v1/auth/login')
      .send({ identifier: user.email, password: user.password })
      .expect(200);
    const row = await prisma.user.findUnique({ where: { id: user.id }, select: { lastLoginAt: true } });
    expect(row?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('rejects a wrong password', async () => {
    const user = await registerUser();
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: user.email, password: 'WrongPass1!' })
      .expect(401);
    expect(res.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
  });

  it('gives an unknown identifier the same error as a wrong password', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: uniqueEmail('ghost'), password: VALID_PASSWORD })
      .expect(401);
    expect(res.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
  });

  it('refuses a suspended account', async () => {
    const user = await registerUser();
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: user.email, password: user.password })
      .expect(403);
    expect(res.body.error.code).toBe(ErrorCode.ACCOUNT_SUSPENDED);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the current user for a bearer token', async () => {
    const user = await registerUser();
    const res = await api()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(res.body.data.user.id).toBe(user.id);
  });

  it('rejects a request with no token', async () => {
    const res = await api().get('/api/v1/auth/me').expect(401);
    expect(res.body.error.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('rejects a malformed token', async () => {
    const res = await api()
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);
    expect(res.body.error.code).toBe(ErrorCode.TOKEN_INVALID);
  });

  it('blocks a user suspended after their token was issued', async () => {
    const user = await registerUser();
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    const res = await api()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(403);
    expect(res.body.error.code).toBe(ErrorCode.ACCOUNT_SUSPENDED);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('rotates the refresh token', async () => {
    const user = await registerUser();
    const res = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(200);

    expect(res.body.data.tokens.refreshToken).not.toBe(user.refreshToken);
    expect(res.body.data.tokens.accessToken).toBeTypeOf('string');
  });

  it('revokes every session when a rotated token is replayed', async () => {
    const user = await registerUser();
    const first = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(200);
    const rotated = first.body.data.tokens.refreshToken as string;

    // Replaying the original is treated as a leak.
    const replay = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);
    expect(replay.body.error.code).toBe(ErrorCode.TOKEN_INVALID);

    // …and that kills the successor too.
    await api().post('/api/v1/auth/refresh').send({ refreshToken: rotated }).expect(401);

    const live = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(live).toBe(0);
  });

  it('rejects an unknown refresh token', async () => {
    const res = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'nonexistent-token-value' })
      .expect(401);
    expect(res.body.error.code).toBe(ErrorCode.TOKEN_INVALID);
  });

  it('refuses an expired refresh token', async () => {
    const user = await registerUser();
    await prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);
    expect(res.body.error.code).toBe(ErrorCode.TOKEN_EXPIRED);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the presented refresh token and clears cookies', async () => {
    const user = await registerUser();
    const res = await api()
      .post('/api/v1/auth/logout')
      .send({ refreshToken: user.refreshToken })
      .expect(204);

    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(cookies.some((c) => c.startsWith('lunch_access_token=;'))).toBe(true);

    await api().post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
  });

  it('succeeds even with no token (idempotent sign-out)', async () => {
    await api().post('/api/v1/auth/logout').send({}).expect(204);
  });
});

describe('POST /api/v1/auth/change-password', () => {
  it('changes the password and ends all sessions', async () => {
    const user = await registerUser();
    const newPassword = 'Br4ndNewPass!';

    await api()
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ currentPassword: user.password, newPassword })
      .expect(204);

    // Old refresh token is dead.
    await api().post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
    // Old password no longer works.
    await api()
      .post('/api/v1/auth/login')
      .send({ identifier: user.email, password: user.password })
      .expect(401);
    // New one does.
    await api()
      .post('/api/v1/auth/login')
      .send({ identifier: user.email, password: newPassword })
      .expect(200);
  });

  it('rejects a wrong current password', async () => {
    const user = await registerUser();
    const res = await api()
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ currentPassword: 'NotMyPass1!', newPassword: 'An0therPass!' })
      .expect(401);
    expect(res.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
  });

  it('requires authentication', async () => {
    await api()
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: VALID_PASSWORD, newPassword: 'An0therPass!' })
      .expect(401);
  });
});

describe('platform behaviour', () => {
  it('reports readiness with database latency', async () => {
    const res = await api().get('/api/v1/health/ready').expect(200);
    expect(res.body.data.database.reachable).toBe(true);
  });

  it('returns a structured 404 for an unknown endpoint', async () => {
    const res = await api().get('/api/v1/nope').expect(404);
    expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('returns a 400 for malformed JSON rather than a 500', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"identifier":')
      .expect(400);
    expect(res.body.error.code).toBe(ErrorCode.BAD_REQUEST);
  });

  it('does not advertise the server technology', async () => {
    const res = await api().get('/api/v1/health/live').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
