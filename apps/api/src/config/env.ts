/**
 * Environment configuration.
 *
 * Every secret and tunable enters the application through this file and nowhere
 * else — `process.env` is not read anywhere beyond this module. The schema is
 * validated at boot so a misconfigured deploy fails immediately and loudly
 * rather than at the first request that happens to need the variable.
 */
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// The monorepo keeps one .env at the repo root; apps/api/.env is a symlink to it.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const durationSchema = z
  .string()
  .regex(/^\d+[smhd]$/, 'Use a duration like 15m, 24h or 30d');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  API_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: durationSchema.default('15m'),
  JWT_REFRESH_TTL: durationSchema.default('30d'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DELIVERY_OTP_TTL_MINUTES: z.coerce.number().int().min(1).max(720).default(30),
  DELIVERY_OTP_SECRET: z.string().min(32).optional(),
  DELIVERY_OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),

  TRACKING_WORKER_ENABLED: z.enum(['true','false']).default('true').transform(v=>v==='true'),
  TRACKING_LATE_GRACE_MINUTES: z.coerce.number().int().min(0).max(60).default(5),

  NOTIFICATION_PROVIDER: z.enum(['disabled','gateway']).default('disabled'),
  NOTIFICATION_GATEWAY_URL: z.string().url().optional(),
  NOTIFICATION_GATEWAY_TOKEN: z.string().min(16).optional(),
  NOTIFICATION_WORKER_ENABLED: z.enum(['true','false']).default('true').transform(v=>v==='true'),

  PAYMENT_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  MOCK_PAYMENT_WEBHOOK_SECRET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // Deliberately not using the logger: it depends on this module.
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
export type Env = typeof env;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDevelopment = env.NODE_ENV === 'development';

/** Fail closed: simulation can never settle money in production. */
if (isProduction && env.PAYMENT_PROVIDER === 'mock') {
  console.error('Production requires a real payment provider.');
  process.exit(1);
}
if (env.PAYMENT_PROVIDER === 'razorpay' &&
    (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET)) {
  console.error('Razorpay requires KEY_ID, KEY_SECRET and WEBHOOK_SECRET.');
  process.exit(1);
}

if (isProduction && !env.DELIVERY_OTP_SECRET) {
  console.error('Production requires DELIVERY_OTP_SECRET (at least 32 characters).');
  process.exit(1);
}

if (env.NOTIFICATION_PROVIDER === 'gateway' &&
    (!env.NOTIFICATION_GATEWAY_URL || !env.NOTIFICATION_GATEWAY_TOKEN ||
     (isProduction && !env.NOTIFICATION_GATEWAY_URL.startsWith('https://')))) {
  console.error('Notification gateway requires a URL and token; production requires HTTPS.');
  process.exit(1);
}

if(isProduction && env.BCRYPT_ROUNDS < 10) { console.error('Production requires BCRYPT_ROUNDS >= 10'); process.exit(1); }
