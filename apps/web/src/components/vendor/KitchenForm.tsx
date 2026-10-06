'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { updateKitchenSchema, type KitchenDetail } from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { blankToNull, parseWithSchema, toFormErrors, type FieldErrors } from '@/lib/form';
import type { RefOption } from '@/lib/reference';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { FormSection } from '@/components/forms/FormSection';

const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
];

/** `510` → `"08:30"`, for an `<input type="time">`. */
function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** `"08:30"` → `510`. */
function timeToMinutes(value: string): number {
  const [h = '0', m = '0'] = value.split(':');
  return Number(h) * 60 + Number(m);
}

export function KitchenForm({
  kitchen,
  checkpoints,
  readOnly,
}: {
  kitchen: KitchenDetail;
  checkpoints: RefOption[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Service areas are a checkbox set, so they need controlled state.
  const [selectedAreas, setSelectedAreas] = useState<Set<string>>(
    () => new Set(kitchen.serviceAreas.map((a) => a.checkpointId))
  );
  const [savingAreas, setSavingAreas] = useState(false);

  const hoursByDay = new Map(kitchen.operatingHours.map((h) => [h.dayOfWeek, h]));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setSaved(false);

    const f = new FormData(event.currentTarget);

    const operatingHours = DAYS.map((day) => ({
      dayOfWeek: day.value,
      opensMinute: timeToMinutes(String(f.get(`opens-${day.value}`) ?? '06:00')),
      closesMinute: timeToMinutes(String(f.get(`closes-${day.value}`) ?? '22:00')),
      isClosed: f.get(`closed-${day.value}`) === 'on',
    }));

    const parsed = parseWithSchema(updateKitchenSchema, {
      name: String(f.get('name') ?? '').trim(),
      contactPhone: blankToNull(f.get('contactPhone')),
      capacityPerSlot: String(f.get('capacityPerSlot') ?? ''),
      address: {
        line1: String(f.get('line1') ?? '').trim(),
        line2: blankToNull(f.get('line2')),
        landmark: blankToNull(f.get('landmark')),
        area: blankToNull(f.get('area')),
        cityName: String(f.get('cityName') ?? '').trim(),
        state: String(f.get('state') ?? '').trim(),
        postalCode: String(f.get('postalCode') ?? '').trim(),
      },
      operatingHours,
    });

    if (!parsed.ok) {
      setFieldErrors(parsed.fields);
      return;
    }

    setSaving(true);
    try {
      await apiClient.patch(`/v1/vendor/kitchens/${kitchen.id}`, parsed.data);
      setSaved(true);
      router.refresh();
    } catch (err) {
      const { fields, formError: message } = toFormErrors(err);
      setFieldErrors(fields);
      setFormError(message);
    } finally {
      setSaving(false);
    }
  }

  async function saveServiceAreas() {
    setFormError(null);
    setSavingAreas(true);
    try {
      await apiClient.put(`/v1/vendor/kitchens/${kitchen.id}/service-areas`, {
        checkpoints: [...selectedAreas].map((checkpointId) => ({ checkpointId })),
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      const { formError: message, fields } = toFormErrors(err);
      setFormError(message ?? Object.values(fields)[0] ?? 'Those delivery areas were not accepted.');
    } finally {
      setSavingAreas(false);
    }
  }

  return (
    <div className="space-y-8">
      {formError && <Alert tone="error">{formError}</Alert>}
      {saved && <Alert tone="success">Your kitchen has been saved.</Alert>}

      <form onSubmit={handleSubmit} noValidate className="space-y-8">
        <fieldset disabled={readOnly} className="space-y-8 disabled:opacity-60">
          <FormSection title="Kitchen" description="What this production unit is called and how we reach it.">
            <TextField
              label="Kitchen name"
              name="name"
              defaultValue={kitchen.name}
              required
              error={fieldErrors['name']}
            />
            <TextField
              label="Contact phone"
              name="contactPhone"
              type="tel"
              defaultValue={kitchen.contactPhone ?? ''}
              error={fieldErrors['contactPhone']}
            />
            <TextField
              label="Capacity per time slot"
              name="capacityPerSlot"
              type="number"
              min={1}
              defaultValue={kitchen.capacityPerSlot}
              required
              error={fieldErrors['capacityPerSlot']}
              hint="The most meals this kitchen can produce for one delivery slot."
            />
          </FormSection>

          <FormSection title="Address" description="Where riders collect from.">
            <TextField
              label="Street address"
              name="line1"
              defaultValue={kitchen.address?.line1 ?? ''}
              required
              error={fieldErrors['address.line1']}
            />
            <TextField
              label="Address line 2"
              name="line2"
              defaultValue={kitchen.address?.line2 ?? ''}
              error={fieldErrors['address.line2']}
            />
            <TextField
              label="Area"
              name="area"
              defaultValue={kitchen.address?.area ?? ''}
              error={fieldErrors['address.area']}
            />
            <TextField
              label="Landmark"
              name="landmark"
              defaultValue={kitchen.address?.landmark ?? ''}
              error={fieldErrors['address.landmark']}
            />
            <TextField
              label="City"
              name="cityName"
              defaultValue={kitchen.address?.cityName ?? kitchen.city?.name ?? ''}
              required
              error={fieldErrors['address.cityName']}
            />
            <TextField
              label="State"
              name="state"
              defaultValue={kitchen.address?.state ?? ''}
              required
              error={fieldErrors['address.state']}
            />
            <TextField
              label="PIN code"
              name="postalCode"
              inputMode="numeric"
              maxLength={6}
              defaultValue={kitchen.address?.postalCode ?? ''}
              required
              error={fieldErrors['address.postalCode']}
            />
          </FormSection>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-slate-900">Operating hours</h2>
              <p className="mt-1 text-sm text-slate-500">
                When this kitchen can cook. Tick a day to mark it closed.
              </p>
            </div>
            <ul className="space-y-3">
              {DAYS.map((day) => {
                const existing = hoursByDay.get(day.value);
                return (
                  <li
                    key={day.value}
                    className="flex flex-wrap items-center gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0"
                  >
                    <span className="w-24 shrink-0 text-sm font-medium text-slate-900">
                      {day.label}
                    </span>
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <span className="sr-only">{day.label} opening time</span>
                      <input
                        type="time"
                        name={`opens-${day.value}`}
                        defaultValue={minutesToTime(existing?.opensMinute ?? 360)}
                        className="rounded-md border-0 px-2 py-1.5 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
                      />
                      <span aria-hidden="true">–</span>
                      <span className="sr-only">{day.label} closing time</span>
                      <input
                        type="time"
                        name={`closes-${day.value}`}
                        defaultValue={minutesToTime(existing?.closesMinute ?? 1320)}
                        className="rounded-md border-0 px-2 py-1.5 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        name={`closed-${day.value}`}
                        defaultChecked={existing?.isClosed ?? false}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                      />
                      Closed
                    </label>
                  </li>
                );
              })}
            </ul>
            {fieldErrors['operatingHours'] && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {fieldErrors['operatingHours']}
              </p>
            )}
          </section>

          <div className="flex justify-end">
            <Button type="submit" size="lg" loading={saving}>
              {saving ? 'Saving…' : 'Save kitchen'}
            </Button>
          </div>
        </fieldset>
      </form>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-slate-900">Delivery areas</h2>
          <p className="mt-1 text-sm text-slate-500">
            The checkpoints this kitchen will deliver to. Customers only see your meals for
            checkpoints you serve.
          </p>
        </div>

        <ul className="grid gap-2 sm:grid-cols-2">
          {checkpoints.map((cp) => (
            <li key={cp.id}>
              <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={selectedAreas.has(cp.id)}
                  onChange={(e) => {
                    const next = new Set(selectedAreas);
                    if (e.target.checked) next.add(cp.id);
                    else next.delete(cp.id);
                    setSelectedAreas(next);
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                />
                {cp.name}
              </label>
            </li>
          ))}
        </ul>

        {!readOnly && (
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" loading={savingAreas} onClick={saveServiceAreas}>
              {savingAreas ? 'Saving…' : `Save ${selectedAreas.size} delivery areas`}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
