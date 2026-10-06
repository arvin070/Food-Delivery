import { z } from 'zod';
import { DietaryPreference } from '../enums/index.js';
import { dateOnlySchema, emailSchema, idSchema, nameSchema, phoneSchema } from './common.js';

const dietaryPreferenceSchema = z.enum(
  Object.values(DietaryPreference) as [DietaryPreference, ...DietaryPreference[]]
);

/**
 * Softer than dietary preference: cuisines and tastes, used for filtering and
 * later for recommendations. Free-form rather than an enum because the list
 * grows with the menu.
 */
const foodPreferencesSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(20, 'Pick at most 20 preferences')
  .transform((tags) => Array.from(new Set(tags.map((t) => t.toLowerCase()))));

const emergencyContactFields = {
  emergencyContactName: nameSchema.nullish(),
  emergencyContactPhone: phoneSchema.nullish(),
  emergencyContactRelation: z.string().trim().max(40).nullish(),
};

/**
 * An emergency contact is only useful with both a name and a number, so reject
 * a half-filled one rather than storing something nobody can act on.
 */
function emergencyContactIsComplete(value: {
  emergencyContactName?: string | null | undefined;
  emergencyContactPhone?: string | null | undefined;
}): boolean {
  const hasName = Boolean(value.emergencyContactName);
  const hasPhone = Boolean(value.emergencyContactPhone);
  return hasName === hasPhone;
}

const EMERGENCY_CONTACT_ISSUE = {
  message: 'Give both a name and a phone number for the emergency contact, or leave both blank',
  path: ['emergencyContactPhone'] as (string | number)[],
};

// ─── Customer profile ────────────────────────────────────────────────────────

export const updateProfileSchema = z
  .object({
    fullName: nameSchema.optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    dateOfBirth: dateOnlySchema.nullish(),
    avatarUrl: z.string().url().max(2048).nullish(),

    dietaryPreference: dietaryPreferenceSchema.optional(),
    allergies: z.string().trim().max(500).nullish(),
    foodPreferences: foodPreferencesSchema.optional(),

    defaultCheckpointId: idSchema.nullish(),
    defaultTimeSlotId: idSchema.nullish(),
    cityId: idSchema.nullish(),

    ...emergencyContactFields,
  })
  .refine(emergencyContactIsComplete, EMERGENCY_CONTACT_ISSUE);
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export interface ProfileSummaryRef {
  id: string;
  name: string;
}

export interface CustomerProfile {
  userId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: string;
  emailVerified: boolean;
  phoneVerified: boolean;

  dateOfBirth: string | null;
  avatarUrl: string | null;
  dietaryPreference: DietaryPreference;
  allergies: string | null;
  foodPreferences: string[];

  defaultCheckpoint: ProfileSummaryRef | null;
  defaultTimeSlot: ProfileSummaryRef | null;
  city: ProfileSummaryRef | null;

  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;

  /** How many children this account manages. */
  childCount: number;
}

// ─── Children ────────────────────────────────────────────────────────────────

const childFields = {
  fullName: nameSchema,
  dateOfBirth: dateOnlySchema.nullish(),

  institutionId: idSchema.nullish(),
  /** Class, grade, year or course — e.g. "Grade 7", "II B.Tech CSE". */
  grade: z.string().trim().max(60).nullish(),
  section: z.string().trim().max(20).nullish(),
  /** Roll number or student ID, where the institution requires one. */
  rollNumber: z.string().trim().max(60).nullish(),

  defaultCheckpointId: idSchema.nullish(),
  defaultTimeSlotId: idSchema.nullish(),

  dietaryPreference: dietaryPreferenceSchema.default(DietaryPreference.NONE),
  allergies: z.string().trim().max(500).nullish(),
  foodPreferences: foodPreferencesSchema.optional(),
  notes: z.string().trim().max(1000).nullish(),

  ...emergencyContactFields,
};

export const createChildSchema = z
  .object(childFields)
  .refine(emergencyContactIsComplete, EMERGENCY_CONTACT_ISSUE)
  .refine(
    (v) => {
      if (!v.dateOfBirth) return true;
      const dob = new Date(`${v.dateOfBirth}T00:00:00Z`);
      return dob.getTime() <= Date.now();
    },
    { message: 'Date of birth cannot be in the future', path: ['dateOfBirth'] }
  )
  .refine(
    (v) => {
      if (!v.dateOfBirth) return true;
      const dob = new Date(`${v.dateOfBirth}T00:00:00Z`);
      // A sanity bound, not a policy: catches typos like 1902 or 2202.
      const ageYears = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
      return ageYears <= 30;
    },
    { message: 'Check this date — it gives an age over 30', path: ['dateOfBirth'] }
  );
export type CreateChildInput = z.infer<typeof createChildSchema>;

/**
 * Every field optional for a partial update, but the emergency-contact pairing
 * rule still applies to whatever is sent.
 */
export const updateChildSchema = z
  .object(childFields)
  .partial()
  .refine(emergencyContactIsComplete, EMERGENCY_CONTACT_ISSUE);
export type UpdateChildInput = z.infer<typeof updateChildSchema>;

export const childIdParamSchema = z.object({ childId: idSchema });

export interface Child {
  id: string;
  fullName: string;
  dateOfBirth: string | null;
  /** Derived from `dateOfBirth`; null when no date is recorded. */
  age: number | null;

  institution: ProfileSummaryRef | null;
  grade: string | null;
  section: string | null;
  rollNumber: string | null;

  defaultCheckpoint: ProfileSummaryRef | null;
  defaultTimeSlot: ProfileSummaryRef | null;

  dietaryPreference: DietaryPreference;
  allergies: string | null;
  foodPreferences: string[];
  notes: string | null;

  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;

  /** True once the child has been given their own STUDENT login. */
  hasOwnLogin: boolean;
  isActive: boolean;
  createdAt: string;
}
