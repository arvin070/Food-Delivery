import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { prisma } from '../src/core/prisma';

export const app: Express = createApp();
export const api = () => request(app);

/** Marks every record a test creates, so cleanup is a single deleteMany. */
export const TEST_EMAIL_DOMAIN = 'test.lunch';

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@${TEST_EMAIL_DOMAIN}`;
}

export function uniquePhone(): string {
  // +9199 + 8 random digits keeps it inside the schema's phone pattern.
  return `+9199${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

export const VALID_PASSWORD = 'Str0ngPass!';

export interface RegisteredUser {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
}

export async function registerUser(
  overrides: Partial<{ fullName: string; email: string; password: string; role: string }> = {}
): Promise<RegisteredUser> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? VALID_PASSWORD;

  const res = await api()
    .post('/api/v1/auth/register')
    .send({
      fullName: overrides.fullName ?? 'Test Person',
      email,
      password,
      ...(overrides.role ? { role: overrides.role } : {}),
    })
    .expect(201);

  return {
    id: res.body.data.user.id,
    email,
    password,
    accessToken: res.body.data.tokens.accessToken,
    refreshToken: res.body.data.tokens.refreshToken,
  };
}

/** Removes everything the suite created. Cascades handle the dependent rows. */
export async function cleanupTestUsers(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
