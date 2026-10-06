import { z } from 'zod';
import { UserRole, UserStatus } from '../enums/index.js';
import { idSchema, paginationSchema } from './common.js';

/** Filters for the admin user list. */
export const listUsersQuerySchema = paginationSchema.extend({
  role: z.enum(Object.values(UserRole) as [UserRole, ...UserRole[]]).optional(),
  status: z.enum(Object.values(UserStatus) as [UserStatus, ...UserStatus[]]).optional(),
  /** Matches against name, email or phone. */
  search: z.string().trim().min(1).max(120).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/**
 * Account status changes an administrator may make.
 *
 * `PENDING_VERIFICATION` is absent on purpose: it is a state the system assigns
 * at sign-up, not something an operator moves an account back into.
 */
export const updateUserStatusSchema = z.object({
  status: z.enum([UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.DEACTIVATED]),
  /** Recorded in the audit log; required when suspending or deactivating. */
  reason: z.string().trim().max(500).optional(),
});
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

export const userIdPathSchema = z.object({ userId: idSchema });
