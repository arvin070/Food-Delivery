import { z } from 'zod';
import { SELF_SIGNUP_ROLES, UserRole } from '../enums/index.js';
import { emailSchema, idSchema, nameSchema, passwordSchema, phoneSchema } from './common.js';

/**
 * Registration. A user may sign up with an email, a phone number, or both —
 * but at least one, because it is their login identifier.
 */
export const registerSchema = z
  .object({
    fullName: nameSchema,
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema,
    role: z
      .enum(Object.values(UserRole) as [UserRole, ...UserRole[]])
      .default(UserRole.CUSTOMER)
      .refine((r) => SELF_SIGNUP_ROLES.includes(r), {
        message: 'This role cannot be self-registered',
      }),
  })
  .refine((v) => Boolean(v.email || v.phone), {
    message: 'Provide an email address or a phone number',
    path: ['email'],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  /** Email address or phone number. */
  identifier: z.string().trim().min(3, 'Enter your email or phone number').max(254),
  password: z.string().min(1, 'Enter your password').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(256).optional(),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** The authenticated principal, as encoded in the access token. */
export interface AuthPrincipal {
  /** Revocable session backing this access token. */
  sessionId?: string;
  userId: string;
  role: UserRole;
  /** Present for VENDOR users — the vendor they operate. */
  vendorId?: string;
  /** Present for DELIVERY_PARTNER users. */
  deliveryPartnerId?: string;
  /** Present for INSTITUTION_ADMIN users. */
  institutionId?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
}

export interface PublicUser {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: string;
}

export interface AuthSession {
  user: PublicUser;
  tokens: AuthTokens;
}

export const userIdParamSchema = z.object({ userId: idSchema });

// ─── Password reset ──────────────────────────────────────────────────────────

export const requestPasswordResetSchema = z.object({
  /** Email address or phone number of the account to reset. */
  identifier: z.string().trim().min(3, 'Enter your email or phone number').max(254),
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const confirmPasswordResetSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email or phone number').max(254),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
  newPassword: passwordSchema,
});
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>;

/**
 * Response to a reset request.
 *
 * `sentTo` is masked, and is present whether or not the account exists — the
 * endpoint must not reveal which identifiers are registered.
 */
export interface PasswordResetRequested {
  sentTo: string;
  /** Development only: the code, so clients can be exercised without a mailbox. */
  devCode?: string;
}

// ─── Email / phone verification ──────────────────────────────────────────────

export const verificationChannelSchema = z.enum(['email', 'phone']);
export type VerificationChannel = z.infer<typeof verificationChannelSchema>;

export const requestVerificationSchema = z.object({
  channel: verificationChannelSchema,
});
export type RequestVerificationInput = z.infer<typeof requestVerificationSchema>;

export const confirmVerificationSchema = z.object({
  channel: verificationChannelSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type ConfirmVerificationInput = z.infer<typeof confirmVerificationSchema>;

export interface VerificationRequested {
  channel: VerificationChannel;
  sentTo: string;
  devCode?: string;
}
