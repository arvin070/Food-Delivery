import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 256 bits of entropy, URL-safe. Used for refresh tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * SHA-256 hex digest. Used to store refresh tokens and delivery OTPs.
 *
 * SHA-256 (not bcrypt) is correct here: these secrets are high-entropy random
 * values, so there is nothing to brute-force, and verification happens on every
 * request where a slow KDF would be a liability.
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** A numeric code of `digits` length, uniformly distributed, zero-padded. */
export function numericCode(digits = 6): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, '0');
}

/** Human-facing order reference, e.g. `LN-7F3K9QW2`. */
export function orderNumber(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  let out = '';
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return `LN-${out}`;
}
