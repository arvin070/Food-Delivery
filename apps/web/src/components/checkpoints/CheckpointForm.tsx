'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  CheckpointType,
  CHECKPOINT_TYPE_LABELS,
  createCheckpointSchema,
  updateCheckpointSchema,
  type CheckpointDetail,
} from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import {
  blankToNull,
  blankToUndefined,
  parseWithSchema,
  toFormErrors,
  type FieldErrors,
} from '@/lib/form';
import type { RefOption } from '@/lib/reference';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { FormSection } from '@/components/forms/FormSection';

interface CheckpointFormReferenceData {
  cities: RefOption[];
  zones: RefOption[];
  institutions: RefOption[];
  timeSlots: RefOption[];
}

const TYPE_OPTIONS = Object.entries(CHECKPOINT_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/**
 * Admin form for creating and editing checkpoints.
 * `checkpoint` present → edit mode; absent → create mode.
 */
export function CheckpointForm({
  checkpoint,
  reference,
  backHref = '/admin/checkpoints',
}: {
  checkpoint?: CheckpointDetail;
  reference: CheckpointFormReferenceData;
  backHref?: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(checkpoint);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const f = new FormData(event.currentTarget);
    const raw = {
      name: String(f.get('name') ?? '').trim(),
      type: blankToUndefined(f.get('type')) ?? 'OTHER',
      cityId: blankToNull(f.get('cityId')),
      zoneId: blankToNull(f.get('zoneId')),
      institutionId: blankToNull(f.get('institutionId')),
      latitude: f.get('latitude') ? Number(f.get('latitude')) : null,
      longitude: f.get('longitude') ? Number(f.get('longitude')) : null,
      geofenceRadiusM: f.get('geofenceRadiusM') ? Number(f.get('geofenceRadiusM')) : undefined,
      instructions: blankToNull(f.get('instructions')),
      deliveryCapacity: f.get('deliveryCapacity') ? Number(f.get('deliveryCapacity')) : null,
      isActive: f.get('isActive') === 'true',
      windows: reference.timeSlots.flatMap((slot) => {
        if (f.get(`window.${slot.id}.enabled`) !== 'on') return [];
        const maxOrders = f.get(`window.${slot.id}.maxOrders`);
        const orderCutoffMinutes = f.get(`window.${slot.id}.orderCutoffMinutes`);
        const preparationBufferMinutes = f.get(`window.${slot.id}.preparationBufferMinutes`);
        const travelBufferMinutes = f.get(`window.${slot.id}.travelBufferMinutes`);
        return [{
          timeSlotId: slot.id,
          maxOrders: maxOrders ? Number(maxOrders) : null,
          orderCutoffMinutes: orderCutoffMinutes ? Number(orderCutoffMinutes) : null,
          weekdays: [1, 2, 3, 4, 5, 6, 7].filter(day => f.get(`window.${slot.id}.weekday.${day}`) === 'on'),
          preparationBufferMinutes: preparationBufferMinutes ? Number(preparationBufferMinutes) : 0,
          travelBufferMinutes: travelBufferMinutes ? Number(travelBufferMinutes) : 0,
          isActive: true,
        }];
      }),
      // Address sub-object
      address: (() => {
        const line1 = String(f.get('address.line1') ?? '').trim();
        if (!line1) return null;
        return {
          line1,
          line2: blankToNull(f.get('address.line2')),
          landmark: blankToNull(f.get('address.landmark')),
          area: blankToNull(f.get('address.area')),
          cityName: String(f.get('address.cityName') ?? '').trim(),
          state: String(f.get('address.state') ?? '').trim(),
          postalCode: String(f.get('address.postalCode') ?? '').trim(),
        };
      })(),
    };

    const parsed = parseWithSchema(isEdit ? updateCheckpointSchema : createCheckpointSchema, raw);
    if (!parsed.ok) {
      setFieldErrors(parsed.fields);
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await apiClient.patch(`/v1/checkpoints/${checkpoint!.id}`, parsed.data);
      } else {
        await apiClient.post('/v1/checkpoints', parsed.data);
      }
      router.refresh();
      router.push(backHref);
    } catch (err) {
      const { fields, formError: msg } = toFormErrors(err);
      setFieldErrors(fields);
      setFormError(msg);
      setSaving(false);
    }
  }

  const statusOptions = [
    { value: 'true', label: 'Active' },
    { value: 'false', label: 'Inactive' },
  ];

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-8">
      {formError && <Alert tone="error">{formError}</Alert>}

      <FormSection
        title="Checkpoint identity"
        description="The name and type are shown to customers during checkout."
      >
        <TextField
          label="Name"
          name="name"
          defaultValue={checkpoint?.name ?? ''}
          autoFocus={!isEdit}
          required
          placeholder="ABC College — Gate A"
          error={fieldErrors['name']}
        />
        <SelectField
          label="Type"
          name="type"
          defaultValue={checkpoint?.type ?? ''}
          options={[{ value: '', label: 'Select type…' }, ...TYPE_OPTIONS]}
          error={fieldErrors['type']}
        />
      </FormSection>

      <FormSection
        title="Location"
        description="City and zone are required for routing. Coordinates enable future map integration."
      >
        <SelectField
          label="City"
          name="cityId"
          defaultValue={checkpoint?.city?.id ?? ''}
          options={[
            { value: '', label: 'Select city…' },
            ...reference.cities.map((c) => ({ value: c.id, label: c.name })),
          ]}
          error={fieldErrors['cityId']}
        />
        <SelectField
          label="Zone (optional)"
          name="zoneId"
          defaultValue={checkpoint?.zone?.id ?? ''}
          options={[
            { value: '', label: 'No zone' },
            ...reference.zones.map((z) => ({ value: z.id, label: z.name })),
          ]}
          error={fieldErrors['zoneId']}
        />
        <SelectField
          label="Institution (optional)"
          name="institutionId"
          defaultValue={checkpoint?.institution?.id ?? ''}
          options={[
            { value: '', label: 'Not institution-specific' },
            ...reference.institutions.map((i) => ({ value: i.id, label: i.name })),
          ]}
          error={fieldErrors['institutionId']}
        />
        <TextField
          label="Latitude (optional)"
          name="latitude"
          type="number"
          step="any"
          defaultValue={checkpoint?.latitude?.toString() ?? ''}
          placeholder="12.9716"
          hint="Enables geolocation validation for riders."
          error={fieldErrors['latitude']}
        />
        <TextField
          label="Longitude (optional)"
          name="longitude"
          type="number"
          step="any"
          defaultValue={checkpoint?.longitude?.toString() ?? ''}
          placeholder="77.5946"
          error={fieldErrors['longitude']}
        />
        <TextField
          label="Geofence radius (metres)"
          name="geofenceRadiusM"
          type="number"
          defaultValue={checkpoint?.geofenceRadiusM?.toString() ?? '150'}
          hint="Riders must be within this radius to mark delivery."
          error={fieldErrors['geofenceRadiusM']}
        />
      </FormSection>

      <FormSection
        title="Street address"
        description="Leave blank if the name and coordinates are sufficient."
      >
        <TextField
          label="Line 1"
          name="address.line1"
          defaultValue={checkpoint?.address?.line1 ?? ''}
          placeholder="Main Gate, NH-48"
          error={fieldErrors['address.line1']}
        />
        <TextField
          label="Line 2"
          name="address.line2"
          defaultValue={checkpoint?.address?.line2 ?? ''}
          placeholder="Near SBI ATM"
          error={fieldErrors['address.line2']}
        />
        <TextField
          label="Area / Locality"
          name="address.area"
          defaultValue={checkpoint?.address?.area ?? ''}
          placeholder="Jayanagar"
          error={fieldErrors['address.area']}
        />
        <TextField
          label="City name"
          name="address.cityName"
          defaultValue={checkpoint?.address?.cityName ?? ''}
          placeholder="Bengaluru"
          error={fieldErrors['address.cityName']}
        />
        <TextField
          label="State"
          name="address.state"
          defaultValue={checkpoint?.address?.state ?? ''}
          placeholder="Karnataka"
          error={fieldErrors['address.state']}
        />
        <TextField
          label="Postal code"
          name="address.postalCode"
          defaultValue={checkpoint?.address?.postalCode ?? ''}
          placeholder="560011"
          error={fieldErrors['address.postalCode']}
        />
      </FormSection>

      <FormSection
        title="Operations"
        description="Capacity limits protect the checkpoint from being overwhelmed at peak times."
      >
        <TextField
          label="Delivery capacity (optional)"
          name="deliveryCapacity"
          type="number"
          defaultValue={checkpoint?.deliveryCapacity?.toString() ?? ''}
          placeholder="200"
          hint="Max meals per delivery window. Leave blank for no limit."
          error={fieldErrors['deliveryCapacity']}
        />
        <TextField
          label="Rider instructions"
          name="instructions"
          defaultValue={checkpoint?.instructions ?? ''}
          placeholder="Left of the main gate, near the kiosk"
          hint="Shown on the delivery app — keep it short and spatial."
          error={fieldErrors['instructions']}
        />
        <SelectField
          label="Status"
          name="isActive"
          defaultValue={checkpoint?.isActive !== false ? 'true' : 'false'}
          options={statusOptions}
          error={fieldErrors['isActive']}
        />
      </FormSection>

      <FormSection
        title="Allowed delivery windows"
        description="Choose when customers can receive deliveries at this checkpoint."
      >
        {reference.timeSlots.length === 0 ? (
          <p className="text-sm text-slate-500">No delivery windows are configured yet.</p>
        ) : (
          <div className="space-y-3">
            {reference.timeSlots.map((slot) => {
              const window = checkpoint?.windows.find((item) => item.timeSlotId === slot.id);
              return (
                <div key={slot.id} className="grid gap-3 border-b border-slate-100 pb-3 sm:grid-cols-3 sm:items-end">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-900 sm:pb-2">
                    <input
                      type="checkbox"
                      name={`window.${slot.id}.enabled`}
                      defaultChecked={window?.isActive ?? false}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                    />
                    {slot.name}
                  </label>
                  <TextField
                    label="Max orders for this window"
                    name={`window.${slot.id}.maxOrders`}
                    type="number"
                    min="1"
                    defaultValue={window?.maxOrders?.toString() ?? ''}
                    placeholder="No limit"
                  />
                  <TextField
                    label="Order cutoff (minutes before)"
                    name={`window.${slot.id}.orderCutoffMinutes`}
                    type="number"
                    min="0"
                    max="1440"
                    defaultValue={window?.orderCutoffMinutes?.toString() ?? ''}
                    placeholder="Use time slot default"
                  />
                  <TextField label="Preparation buffer (minutes)" name={`window.${slot.id}.preparationBufferMinutes`}
                    type="number" min="0" max="1440" defaultValue={window?.preparationBufferMinutes?.toString() ?? '0'} />
                  <TextField label="Travel buffer (minutes)" name={`window.${slot.id}.travelBufferMinutes`}
                    type="number" min="0" max="1440" defaultValue={window?.travelBufferMinutes?.toString() ?? '0'} />
                  <fieldset className="sm:col-span-3">
                    <legend className="mb-2 text-sm font-medium">Recurring days</legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => (
                        <label key={day} className="inline-flex items-center gap-2 text-sm">
                          <input type="checkbox" name={`window.${slot.id}.weekday.${index + 1}`} value="on"
                            defaultChecked={window?.weekdays?.includes(index + 1) ?? true} />
                          {day}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
              );
            })}
          </div>
        )}
      </FormSection>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" size="lg" onClick={() => router.push(backHref)}>
          Cancel
        </Button>
        <Button type="submit" size="lg" loading={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create checkpoint'}
        </Button>
      </div>
    </form>
  );
}
