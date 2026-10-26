/**
 * Token issuing and verification.
 *
 * Access tokens are short-lived JWTs bound to a persisted, revocable session.
 * Authentication checks current session and account state on every request.
 *
 * Refresh tokens are opaque random strings. Only their SHA-256 hash is stored,
 * and each use rotates them: the old row is revoked and points at its
 * successor. Presenting an already-rotated token means it leaked, so the whole
 * token family is revoked and every session for that user ends.
 */
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import {
  ErrorCode,
  UserRole,
  type AuthPrincipal,
  type AuthTokens,
} from "@lunch/shared";
import { env } from "../../config/env";
import { unauthenticated } from "../../core/errors";
import { prisma, type Db } from "../../core/prisma";
import { randomToken, sha256 } from "../../lib/crypto";

const ISSUER = "lunch.api";

interface AccessTokenClaims extends JwtPayload {
  sub: string;
  sid: string;
  role: UserRole;
  vendorId?: string;
  deliveryPartnerId?: string;
  institutionId?: string;
}

export function signAccessToken(
  principal: AuthPrincipal & { sessionId: string },
): string {
  const claims: Omit<AccessTokenClaims, "iat" | "exp" | "iss"> = {
    sub: principal.userId,
    sid: principal.sessionId,
    role: principal.role,
    ...(principal.vendorId ? { vendorId: principal.vendorId } : {}),
    ...(principal.deliveryPartnerId
      ? { deliveryPartnerId: principal.deliveryPartnerId }
      : {}),
    ...(principal.institutionId
      ? { institutionId: principal.institutionId }
      : {}),
  };
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_TTL as SignOptions["expiresIn"],
    issuer: ISSUER,
    algorithm: "HS256",
  };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, options);
}

export function verifyAccessToken(token: string): AuthPrincipal {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: ISSUER,
      algorithms: ["HS256"],
    }) as AccessTokenClaims;

    if (
      typeof decoded.sub !== "string" ||
      typeof decoded.sid !== "string" ||
      !decoded.sid ||
      !Object.values(UserRole).includes(decoded.role)
    )
      throw new Error("Token is missing required claims");

    return {
      userId: decoded.sub,
      sessionId: decoded.sid,
      role: decoded.role,
      ...(decoded.vendorId ? { vendorId: decoded.vendorId } : {}),
      ...(decoded.deliveryPartnerId
        ? { deliveryPartnerId: decoded.deliveryPartnerId }
        : {}),
      ...(decoded.institutionId
        ? { institutionId: decoded.institutionId }
        : {}),
    };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw unauthenticated(
        "Your session has expired",
        ErrorCode.TOKEN_EXPIRED,
      );
    }
    throw unauthenticated("Your session is not valid", ErrorCode.TOKEN_INVALID);
  }
}

/** Access-token lifetime in seconds, for the client's refresh scheduling. */
export function accessTokenTtlSeconds(): number {
  const match = /^(\d+)([smhd])$/.exec(env.JWT_ACCESS_TTL);
  if (!match) return 900;
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 } as const;
  return Number(match[1]) * multipliers[match[2] as keyof typeof multipliers];
}

function refreshTokenExpiry(): Date {
  const match = /^(\d+)([smhd])$/.exec(env.JWT_REFRESH_TTL);
  const multipliers = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  } as const;
  const ms = match
    ? Number(match[1]) * multipliers[match[2] as keyof typeof multipliers]
    : 30 * 86_400_000;
  return new Date(Date.now() + ms);
}

export interface SessionContext {
  userAgent?: string;
  ip?: string;
}

/** Issues an access/refresh pair and persists the refresh token's hash. */
export async function issueTokens(
  principal: AuthPrincipal,
  context: SessionContext = {},
  db: Db = prisma,
): Promise<AuthTokens> {
  const refreshToken = randomToken();

  const session = await db.refreshToken.create({
    data: {
      userId: principal.userId,
      tokenHash: sha256(refreshToken),
      expiresAt: refreshTokenExpiry(),
      userAgent: context.userAgent?.slice(0, 255) ?? null,
      ip: context.ip ?? null,
    },
  });

  return {
    accessToken: signAccessToken({ ...principal, sessionId: session.id }),
    refreshToken,
    expiresIn: accessTokenTtlSeconds(),
  };
}

/**
 * Validates a refresh token and rotates it.
 *
 * Replay of a revoked token is treated as a compromise: every refresh token for
 * that user is revoked, forcing a fresh sign-in on all devices.
 */
export async function rotateRefreshToken(
  presentedToken: string,
  context: SessionContext = {},
): Promise<{ principal: AuthPrincipal; tokens: AuthTokens }> {
  const tokenHash = sha256(presentedToken);

  const reference = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: { userId: true },
  });
  if (!reference)
    throw unauthenticated("Your session is not valid", ErrorCode.TOKEN_INVALID);
  const result = await prisma.$transaction(async (tx) => {
    // Same lock order as password changes: user, then session rows.
    await tx.$queryRaw`SELECT id FROM users WHERE id=${reference.userId} FOR UPDATE`;
    const existing = await tx.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            status: true,
            deletedAt: true,
            vendor: { select: { id: true } },
            deliveryPartner: { select: { id: true } },
            institutionMembers: {
              where: { isActive: true, role: "ADMIN" },
              select: { institutionId: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!existing) return { error: "Your session is not valid" };
    if (existing.revokedAt) {
      await revokeAllUserTokens(existing.userId, tx);
      return {
        error: "Your session is no longer valid. Please sign in again.",
      };
    }
    if (existing.expiresAt <= new Date())
      return { error: "Your session has expired", expired: true };
    const user = existing.user;
    if (user.deletedAt || user.status !== "ACTIVE")
      return { error: "Your account is not active" };
    const principal: AuthPrincipal = {
      userId: user.id,
      role: user.role,
      ...(user.vendor ? { vendorId: user.vendor.id } : {}),
      ...(user.deliveryPartner
        ? { deliveryPartnerId: user.deliveryPartner.id }
        : {}),
      ...(user.institutionMembers[0]
        ? { institutionId: user.institutionMembers[0].institutionId }
        : {}),
    };
    const tokens = await issueTokens(principal, context, tx);
    const successor = await tx.refreshToken.findUniqueOrThrow({
      where: { tokenHash: sha256(tokens.refreshToken) },
      select: { id: true },
    });
    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedById: successor.id },
    });
    return { principal, tokens };
  });
  // Throw outside the transaction so replay revocations commit.
  if ("error" in result)
    throw unauthenticated(
      result.error,
      "expired" in result ? ErrorCode.TOKEN_EXPIRED : ErrorCode.TOKEN_INVALID,
    );
  return result;
}

export async function revokeRefreshToken(
  presentedToken: string,
): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(presentedToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserTokens(
  userId: string,
  db: Db = prisma,
): Promise<void> {
  await db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
