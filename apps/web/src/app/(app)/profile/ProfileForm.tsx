'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { updateProfileSchema, type CustomerProfile } from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import {
  blankToNull,
  blankToUndefined,
  parseTags,
  parseWithSchema,
  toFormErrors,
  type FieldErrors,
} from '@/lib/form';
import { DIETARY_OPTIONS, toSelectOptions, type FormReferenceData } from '@/lib/reference';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { FormSection } from '@/components/forms/FormSection';

export function ProfileForm({
  profile,
  reference,
}: {
  profile: CustomerProfile;
  reference: FormReferenceData;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setSaved(false);

    const f = new FormData(event.currentTarget);
    const parsed = parseWithSchema(updateProfileSchema, {
      fullName: blankToUndefined(f.get('fullName')),
      email: blankToUndefined(f.get('email')),
      phone: blankToUndefined(f.get('phone')),
      dateOfBirth: blankToNull(f.get('dateOfBirth')),
      dietaryPreference: blankToUndefined(f.get('dietaryPreference')),
      allergies: blankToNull(f.get('allergies')),
      foodPreferences: parseTags(f.get('foodPreferences')),
      defaultCheckpointId: blankToNull(f.get('defaultCheckpointId')),
      defaultTimeSlotId: blankToNull(f.get('defaultTimeSlotId')),
      cityId: blankToNull(f.get('cityId')),
      emergencyContactName: blankToNull(f.get('emergencyContactName')),
      emergencyContactPhone: blankToNull(f.get('emergencyContactPhone')),
      emergencyContactRelation: blankToNull(f.get('emergencyContactRelation')),
    });

    if (!parsed.ok) {
      setFieldErrors(parsed.fields);
      return;
    }

    setSaving(true);
    try {
      await apiClient.patch('/v1/profile/me', parsed.data);
      setSaved(true);
      // The header shows the user's name, so refresh the server components.
      router.refresh();
    } catch (err) {
      const { fields, formError: message } = toFormErrors(err);
      setFieldErrors(fields);
      setFormError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-8">
      {formError && <Alert tone="error">{formError}</Alert>}
      {saved && <Alert tone="success">Your profile has been saved.</Alert>}

      <FormSection
        title="Contact details"
        description="How we reach you about an order. Changing your email or phone means verifying it again."
      >
        <TextField
          label="Full name"
          name="fullName"
          defaultValue={profile.fullName}
          autoComplete="name"
          required
          error={fieldErrors['fullName']}
        />
        <TextField
          label="Email address"
          name="email"
          type="email"
          defaultValue={profile.email ?? ''}
          autoComplete="email"
          error={fieldErrors['email']}
          hint={profile.email && !profile.emailVerified ? 'Not yet verified.' : undefined}
        />
        <TextField
          label="Phone number"
          name="phone"
          type="tel"
          defaultValue={profile.phone ?? ''}
          autoComplete="tel"
          error={fieldErrors['phone']}
          hint={profile.phone && !profile.phoneVerified ? 'Not yet verified.' : undefined}
        />
        <TextField
          label="Date of birth"
          name="dateOfBirth"
          type="date"
          defaultValue={profile.dateOfBirth ?? ''}
          error={fieldErrors['dateOfBirth']}
        />
      </FormSection>

      <FormSection
        title="Food preferences"
        description="Applied to your own orders. Each child has their own preferences."
      >
        <SelectField
          label="Dietary preference"
          name="dietaryPreference"
          defaultValue={profile.dietaryPreference}
          options={DIETARY_OPTIONS}
          error={fieldErrors['dietaryPreference']}
        />
        <TextField
          label="Allergies"
          name="allergies"
          defaultValue={profile.allergies ?? ''}
          placeholder="Peanuts, shellfish"
          error={fieldErrors['allergies']}
          hint="Shown to the kitchen on every order."
        />
        <TextField
          label="Cuisines you prefer"
          name="foodPreferences"
          defaultValue={profile.foodPreferences.join(', ')}
          placeholder="South Indian, mild"
          error={fieldErrors['foodPreferences']}
          hint="Comma separated. Used to sort the menu."
        />
      </FormSection>

      <FormSection
        title="Delivery defaults"
        description="Pre-filled when you order, so a repeat order is one tap."
      >
        <SelectField
          label="City"
          name="cityId"
          defaultValue={profile.city?.id ?? ''}
          options={toSelectOptions(reference.cities, 'No city selected')}
          error={fieldErrors['cityId']}
        />
        <SelectField
          label="Usual checkpoint"
          name="defaultCheckpointId"
          defaultValue={profile.defaultCheckpoint?.id ?? ''}
          options={toSelectOptions(reference.checkpoints, 'No checkpoint selected')}
          error={fieldErrors['defaultCheckpointId']}
        />
        <SelectField
          label="Usual delivery time"
          name="defaultTimeSlotId"
          defaultValue={profile.defaultTimeSlot?.id ?? ''}
          options={toSelectOptions(reference.timeSlots, 'No delivery time selected')}
          error={fieldErrors['defaultTimeSlotId']}
        />
      </FormSection>

      <FormSection
        title="Emergency contact"
        description="Who we call if a delivery cannot be completed. Give both a name and a number, or leave both blank."
      >
        <TextField
          label="Contact name"
          name="emergencyContactName"
          defaultValue={profile.emergencyContactName ?? ''}
          error={fieldErrors['emergencyContactName']}
        />
        <TextField
          label="Contact phone"
          name="emergencyContactPhone"
          type="tel"
          defaultValue={profile.emergencyContactPhone ?? ''}
          error={fieldErrors['emergencyContactPhone']}
        />
        <TextField
          label="Relationship"
          name="emergencyContactRelation"
          defaultValue={profile.emergencyContactRelation ?? ''}
          placeholder="Spouse, parent, sibling"
          error={fieldErrors['emergencyContactRelation']}
        />
      </FormSection>

      <div className="flex justify-end">
        <Button type="submit" size="lg" loading={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
