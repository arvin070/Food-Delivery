import pino from 'pino';
import { env, isDevelopment } from '../config/env';

/**
 * Application logger. Pretty in development, newline-delimited JSON elsewhere
 * so a log shipper can parse it.
 *
 * `redact` is not optional: these paths carry credentials and OTPs, and they
 * must never reach a log aggregator.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
      '*.passwordHash',
      '*.accessToken',
      '*.refreshToken',
      '*.otp',
      '*.otpHash',
      '*.codeHash',
    ],
    censor: '[redacted]',
  },
  ...(isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

export type Logger = typeof logger;
