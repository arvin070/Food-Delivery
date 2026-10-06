import { z } from 'zod';
import { DietaryPreference } from '../enums/index.js';
import { dateOnlySchema, emailSchema, idSchema, nameSchema, phoneSchema } from './common.js';

const dietaryPreferenceSchema = z.enum(
  Object.values(DietaryPreference) as [DietaryPreference, ...DietaryPreference[]]
);

export const updateProfileSchema = z.object({
  fullName: nameSchema.optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  dateOfBirth: dateOnlySchema.nullish(),
  dietaryPreference: dietaryPreferenceSchema.optional(),
  avatarUrl: z.string().url().max(2048).nullish(),
  defaultCheckpointId: idSchema.nullish(),
  allergies: z.string().trim().max(500).nullish(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const createChildSchema = z.object({
  fullName: nameSchema,
  dateOfBirth: dateOnlySchema.nullish(),
  institutionId: idSchema.nullish(),
  /** Class/grade/year, e.g. "Grade 7", "II B.Tech CSE". */
  grade: z.string().trim().max(60).nullish(),
  section: z.string().trim().max(20).nullish(),
  rollNumber: z.string().trim().max(60).nullish(),
  defaultCheckpointId: idSchema.nullish(),
  dietaryPreference: dietaryPreferenceSchema.default(DietaryPreference.NONE),
  allergies: z.string().trim().max(500).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});
export type CreateChildInput = z.infer<typeof createChildSchema>;

export const updateChildSchema = createChildSchema.partial();
export type UpdateChildInput = z.infer<typeof updateChildSchema>;

export const childIdParamSchema = z.object({ childId: idSchema });
