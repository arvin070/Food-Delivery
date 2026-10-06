'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { createChildSchema, updateChildSchema, type Child } from '@lunch/shared';
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

/**
 * Used for both adding and editing — the fields are identical, so keeping one
 * component means a field added here appears in both flows automatically.
 * `child` being present is what switches it to edit mode.
 */
export function ChildForm({
  child,
  reference,
}: {
  child?: Child | undefined;
  reference: FormReferenceData;
}) {
  const router = useRouter();
  const isEdit = Boolean(child);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const f = new FormData(event.currentTarget);
    const raw = {
      fullName: String(f.get('fullName') ?? '').trim(),
      dateOfBirth: blankToNull(f.get('dateOfBirth')),
      institutionId: blankToNull(f.get('institutionId')),
      grade: blankToNull(f.get('grade')),
      section: blankToNull(f.get('section')),
      rollNumber: blankToNull(f.get('rollNumber')),
      defaultCheckpointId: blankToNull(f.get('defaultCheckpointId')),
      defaultTimeSlotId: blankToNull(f.get('defaultTimeSlotId')),
      dietaryPreference: blankToUndefined(f.get('dietaryPreference')) ?? 'NONE',
      allergies: blankToNull(f.get('allergies')),
      foodPreferences: parseTags(f.get('foodPreferences')),
      notes: blankToNull(f.get('notes')),
      emergencyContactName: blankToNull(f.get('emergencyContactName')),
      emergencyContactPhone: blankToNull(f.get('emergencyContactPhone')),
      emergencyContactRelation: blankToNull(f.get('emergencyContactRelation')),
    };

    const parsed = parseWithSchema(isEdit ? updateChildSchema : createChildSchema, raw);
    if (!parsed.ok) {
      setFieldErrors(parsed.fields);
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await apiClient.patch(`/v1/children/${child!.id}`, parsed.data);
      } else {
        await apiClient.post('/v1/children', parsed.data);
      }
      router.refresh();
      router.push('/children');
    } catch (err) {
      const { fields, formError: message } = toFormErrors(err);
      setFieldErrors(fields);
      setFormError(message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-8">
      {formError && <Alert tone="error">{formError}</Alert>}

      <FormSection title="About the child" description="Only a name is required to get started.">
        <TextField
          label="Full name"
          name="fullName"
          defaultValue={child?.fullName ?? ''}
          autoFocus={!isEdit}
          required
          error={fieldErrors['fullName']}
        />
        <TextField
          label="Date of birth"
          name="dateOfBirth"
          type="date"
          defaultValue={child?.dateOfBirth ?? ''}
          error={fieldErrors['dateOfBirth']}
          hint="Optional. Helps the kitchen with portion sizes."
        />
      </FormSection>

      <FormSection
        title="School or college"
        description="Used to suggest the right checkpoint at ordering time."
      >
        <SelectField
          label="Institution"
          name="institutionId"
          defaultValue={child?.institution?.id ?? ''}
          options={toSelectOptions(reference.institutions, 'Not at an institution')}
          error={fieldErrors['institutionId']}
        />
        <TextField
          label="Class or course"
          name="grade"
          defaultValue={child?.grade ?? ''}
          placeholder="Grade 7, II B.Tech CSE"
          error={fieldErrors['grade']}
        />
        <TextField
          label="Section"
          name="section"
          defaultValue={child?.section ?? ''}
          placeholder="B"
          error={fieldErrors['section']}
        />
        <TextField
          label="Roll number or student ID"
          name="rollNumber"
          defaultValue={child?.rollNumber ?? ''}
          error={fieldErrors['rollNumber']}
          hint="Only if the institution requires it."
        />
      </FormSection>

      <FormSection
        title="Delivery defaults"
        description="Pre-filled when you order for this child. You can still change them per order."
      >
        <SelectField
          label="Default checkpoint"
          name="defaultCheckpointId"
          defaultValue={child?.defaultCheckpoint?.id ?? ''}
          options={toSelectOptions(reference.checkpoints, 'No default checkpoint')}
          error={fieldErrors['defaultCheckpointId']}
        />
        <SelectField
          label="Default delivery time"
          name="defaultTimeSlotId"
          defaultValue={child?.defaultTimeSlot?.id ?? ''}
          options={toSelectOptions(reference.timeSlots, 'No default delivery time')}
          error={fieldErrors['defaultTimeSlotId']}
        />
      </FormSection>

      <FormSection
        title="Food and allergies"
        description="Allergies are shown to the kitchen on every order for this child."
      >
        <SelectField
          label="Dietary preference"
          name="dietaryPreference"
          defaultValue={child?.dietaryPreference ?? 'NONE'}
          options={DIETARY_OPTIONS}
          error={fieldErrors['dietaryPreference']}
        />
        <TextField
          label="Allergies"
          name="allergies"
          defaultValue={child?.allergies ?? ''}
          placeholder="Peanuts, shellfish"
          error={fieldErrors['allergies']}
        />
        <TextField
          label="Cuisines they prefer"
          name="foodPreferences"
          defaultValue={child?.foodPreferences.join(', ') ?? ''}
          placeholder="South Indian, mild"
          error={fieldErrors['foodPreferences']}
          hint="Comma separated."
        />
        <TextField
          label="Notes for the delivery partner"
          name="notes"
          defaultValue={child?.notes ?? ''}
          placeholder="Hand over to the duty teacher only"
          error={fieldErrors['notes']}
        />
      </FormSection>

      <FormSection
        title="Emergency contact"
        description="Often a second parent or guardian. Give both a name and a number, or leave both blank."
      >
        <TextField
          label="Contact name"
          name="emergencyContactName"
          defaultValue={child?.emergencyContactName ?? ''}
          error={fieldErrors['emergencyContactName']}
        />
        <TextField
          label="Contact phone"
          name="emergencyContactPhone"
          type="tel"
          defaultValue={child?.emergencyContactPhone ?? ''}
          error={fieldErrors['emergencyContactPhone']}
        />
        <TextField
          label="Relationship"
          name="emergencyContactRelation"
          defaultValue={child?.emergencyContactRelation ?? ''}
          placeholder="Mother, father, guardian"
          error={fieldErrors['emergencyContactRelation']}
        />
      </FormSection>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" size="lg" onClick={() => router.push('/children')}>
          Cancel
        </Button>
        <Button type="submit" size="lg" loading={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add child'}
        </Button>
      </div>
    </form>
  );
}
