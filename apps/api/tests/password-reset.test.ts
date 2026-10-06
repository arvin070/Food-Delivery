/**
 * Password reset and contact verification.
 *
 * The reset endpoint's most important property is that it does **not** reveal
 * whether an identifier is registered, so several tests here assert sameness
 * rather than success.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, UserStatus } from '@lunch/shared';
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

/** Requests a reset and returns the code the API echoes back outside production. */
async function requestReset(identifier: string): Promise<{ body: Record<string, unknown>; code?: string }> {
  const res = await api()
    .post('/api/v1/auth/password-reset/request')
    .send({ identifier })
    .expect(200);
  return { body: res.body.data, code: res.body.data.devCode };
}

describe('POST /auth/password-reset/request', () => {
  it('issues a code for a real account', async () => {
    const user = await registerUser();
    const { body, code } = await requestReset(user.email);

    expect(code).toMatch(/^\d{6}$/);
    expect(body['sentTo']).toBeTypeOf('string');

    const stored = await prisma.otpVerification.findFirst({
      where: { identifier: user.email, purpose: 'PASSWORD_RESET', consumedAt: null },
    });
    expect(stored).not.toBeNull();
    // Only the hash is kept.
    expect(stored?.codeHash).not.toBe(code);
    expect(stored?.codeHash).toHaveLength(64);
  });

  it('masks the destination rather than echoing it back', async () => {
    const user = await registerUser();
    const { body } = await requestReset(user.email);
    expect(body['sentTo']).not.toBe(user.email);
    expect(String(body['sentTo'])).toContain('*');
  });

  it('does not reveal whether an account exists', async () => {
    const user = await registerUser();
    const real = await api()
      .post('/api/v1/auth/password-reset/request')
      .send({ identifier: user.email })
      .expect(200);

    const unknown = await api()
      .post('/api/v1/auth/password-reset/request')
      .send({ identifier: uniqueEmail('ghost') })
      .expect(200);

    // Same status and same response keys; only the dev code differs.
    expect(Object.keys(unknown.body.data).sort()).toEqual(
      Object.keys(real.body.data).filter((k) => k !== 'devCode').sort()
    );
    expect(unknown.body.data.devCode).toBeUndefined();
  });

  it('does not issue a code for a suspended account', async () => {
    const user = await registerUser();
    await prisma.user.update({ where: { id: user.id }, data: { status: UserStatus.SUSPENDED } });

    const res = await api()
      .post('/api/v1/auth/password-reset/request')
      .send({ identifier: user.email })
      .expect(200);

    expect(res.body.data.devCode).toBeUndefined();
    const stored = await prisma.otpVerification.count({
      where: { identifier: user.email, purpose: 'PASSWORD_RESET' },
    });
    expect(stored).toBe(0);
  });

  it('supersedes an earlier code when a new one is requested', async () => {
    const user = await registerUser();
    const first = await requestReset(user.email);
    const second = await requestReset(user.email);

    expect(first.code).not.toBe(second.code);

    // The old code no longer works.
    const stale = await api()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ identifier: user.email, code: first.code, newPassword: 'N3wPassword!' })
      .expect(422);
    expect(stale.body.error.code).toBe(ErrorCode.OTP_INVALID);

    // The new one does.
    await api()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ identifier: user.email, code: second.code, newPassword: 'N3wPassword!' })
      .expect(204);
  });

  it('rejects a missing identifier', async () => {
    const res = await api().post('/api/v1/auth/password-reset/request').send({}).expect(422);
    expect(res.body.error.details.identifier).toBeDefined();
  });
});

describe('POST /auth/password-reset/confirm', () => {
  it('resets the password and ends every session', async () => {
    const user = await registerUser();
    const { code } = await requestReset(user.email);
    const newPassword = 'R3setPassword!';

    await api()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ identifier: user.email, code, newPassword })
      .expect(204);

    // Old password is dead.
    await api()
      .post('/api/v1/auth/login')
      .send({ identifier: user.email, password: user.password })
      .expect(401);

    // Old refresh token is revoked.
    await api().post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);

    // New password works.
    await api()
      .post('/api/v1/auth/login')
      .send({ identifier: user.email, password: newPassword })
      .expect(200);
  });

  it('consumes the code so it cannot be reused', async () => {
    const user = await registerUser();
    const { code } = await requestReset(user.email);

    await api()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ identifier: user.email, code, newPassword: 'First1Reset!' })
      .expect(204);

    const replay = await api()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ identifier: user.email, code, newPassword: 'Second1Reset!' })
      .expect(422);
    expect(replay.body.error.code).toBe(ErrorCode.OTP_INVALID);
  });

  it('rejects a wrong code and counts the attempt', async () => {
    const user = await registerUser();
    await requestReset(user.email);

    const res = await api()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ identifier: user.email, code: '000000', newPassword: 'N3wPassword!' })
      .expect(422);
    expect(res.body.error.code).toBe(ErrorCode.OTP_INVALID);

    const record = await prisma.otpVerification.findFirst({
      where: { identifier: user.email, purpose: 'PASSWORD_RESET', consumedAt: null },
    });
    expect(record?.attempts).toBe(1);
  });

  it('burns the code after too many wrong attempts', async () => {
    const user = await registerUser();
    const { code } = await requestReset(user.email);

    // Exhaust the attempt budget (DELIVERY_OTP_MAX_ATTEMPTS, default 5).
    for (let i = 0; i < 5; i += 1) {
      await api()
        .post('/api/v1/auth/password-reset/confirm')
        .send({ identifier: user.email, code: '111111', newPassword: 'N3wPassword!' })
        .expect(422);
    }

    // Even the correct code is now refused.
    const res = await api()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ identifier: user.email, code, newPassword: 'N3wPassword!' })
      .expect(422);
    expect(res.body.error.code).toBe(ErrorCode.OTP_ATTEMPTS_EXCEEDED);
  });

  it('refuses an expired code', async () => {
    const user = await registerUser();
    const { code } = await requestReset(user.email);

    await prisma.otpVerification.updateMany({
      where: { identifier: user.email, purpose: 'PASSWORD_RESET', consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await api()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ identifier: user.email, code, newPassword: 'N3wPassword!' })
      .expect(422);
    expect(res.body.error.code).toBe(ErrorCode.OTP_EXPIRED);
  });

  it('enforces password strength on the new password', async () => {
    const user = await registerUser();
    const { code } = await requestReset(user.email);

    const res = await api()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ identifier: user.email, code, newPassword: 'weak' })
      .expect(422);
    expect(res.body.error.details.newPassword).toBeDefined();
  });

  it('rejects a malformed code before touching the database', async () => {
    const res = await api()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ identifier: uniqueEmail(), code: 'abc', newPassword: VALID_PASSWORD })
      .expect(422);
    expect(res.body.error.details.code).toBeDefined();
  });

  it('a code issued for one account cannot reset another', async () => {
    const victim = await registerUser();
    const attacker = await registerUser();
    const { code } = await requestReset(attacker.email);

    const res = await api()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ identifier: victim.email, code, newPassword: 'Tak30ver!' })
      .expect(422);
    expect(res.body.error.code).toBe(ErrorCode.OTP_INVALID);

    // The victim's password is unchanged.
    await api()
      .post('/api/v1/auth/login')
      .send({ identifier: victim.email, password: victim.password })
      .expect(200);
  });
});

describe('contact verification', () => {
  it('verifies an email address end to end', async () => {
    const user = await registerUser();

    const requested = await api()
      .post('/api/v1/auth/verify/request')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ channel: 'email' })
      .expect(200);

    const code = requested.body.data.devCode as string;
    expect(code).toMatch(/^\d{6}$/);
    expect(requested.body.data.sentTo).toContain('*');

    const confirmed = await api()
      .post('/api/v1/auth/verify/confirm')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ channel: 'email', code })
      .expect(200);

    expect(confirmed.body.data.user.emailVerified).toBe(true);
  });

  it('refuses to verify a channel twice', async () => {
    const user = await registerUser();

    const requested = await api()
      .post('/api/v1/auth/verify/request')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ channel: 'email' })
      .expect(200);

    await api()
      .post('/api/v1/auth/verify/confirm')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ channel: 'email', code: requested.body.data.devCode })
      .expect(200);

    await api()
      .post('/api/v1/auth/verify/request')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ channel: 'email' })
      .expect(409);
  });

  it('rejects verifying a channel the account does not have', async () => {
    // Registered with an email only, so there is no phone to verify.
    const user = await registerUser();
    const res = await api()
      .post('/api/v1/auth/verify/request')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ channel: 'phone' })
      .expect(400);
    expect(res.body.error.details.phone).toBeDefined();
  });

  it('verifies a phone number for a phone-registered account', async () => {
    const phone = uniquePhone();
    const registered = await api()
      .post('/api/v1/auth/register')
      .send({ fullName: 'Phone Verify', phone, password: VALID_PASSWORD })
      .expect(201);

    const token = registered.body.data.tokens.accessToken as string;

    const requested = await api()
      .post('/api/v1/auth/verify/request')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'phone' })
      .expect(200);

    const confirmed = await api()
      .post('/api/v1/auth/verify/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'phone', code: requested.body.data.devCode })
      .expect(200);

    expect(confirmed.body.data.user.phoneVerified).toBe(true);

    await prisma.user.delete({ where: { id: registered.body.data.user.id } });
  });

  it('requires authentication', async () => {
    await api().post('/api/v1/auth/verify/request').send({ channel: 'email' }).expect(401);
    await api()
      .post('/api/v1/auth/verify/confirm')
      .send({ channel: 'email', code: '123456' })
      .expect(401);
  });

  it('rejects an unknown channel', async () => {
    const user = await registerUser();
    const res = await api()
      .post('/api/v1/auth/verify/request')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ channel: 'carrier-pigeon' })
      .expect(422);
    expect(res.body.error.details.channel).toBeDefined();
  });
});

describe('credentials never appear in responses', () => {
  it('no reset or verification response carries a hash or token', async () => {
    const user = await registerUser();
    const reset = await requestReset(user.email);

    const verify = await api()
      .post('/api/v1/auth/verify/request')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ channel: 'email' })
      .expect(200);

    for (const payload of [JSON.stringify(reset.body), JSON.stringify(verify.body)]) {
      expect(payload).not.toContain('passwordHash');
      expect(payload).not.toContain('codeHash');
      expect(payload).not.toContain('tokenHash');
    }
  });
});
