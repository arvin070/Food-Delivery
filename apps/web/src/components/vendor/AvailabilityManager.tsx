'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { formatCurrency, type MealAvailability, type VendorMeal } from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { toFormErrors, type FieldErrors } from '@/lib/form';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/States';

interface SlotOption {
  id: string;
  label: string;
}

/** `YYYY-MM-DD` for today plus `offset` days. */
function dateIso(offset: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Every date from `from` to `to`, inclusive. */
function expandRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end && dates.length < 90) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Publishing a dish for a range of dates.
 *
 * The form takes a date *range* rather than individual dates because the real
 * workflow is "serve this every weekday next week" — the range is expanded
 * client-side into the list of dates the API expects.
 */
export function AvailabilityManager({
  meals,
  kitchens,
  timeSlots,
  availability,
  readOnly,
}: {
  meals: VendorMeal[];
  kitchens: { id: string; name: string }[];
  timeSlots: SlotOption[];
  availability: MealAvailability[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [skipWeekends, setSkipWeekends] = useState(false);

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    setFieldErrors({});

    const f = new FormData(event.currentTarget);
    const from = String(f.get('from') ?? '');
    const to = String(f.get('to') ?? from);

    if (selectedSlots.size === 0) {
      setFieldErrors({ timeSlotIds: 'Pick at least one delivery time' });
      return;
    }

    let serviceDates = expandRange(from, to);
    if (skipWeekends) {
      serviceDates = serviceDates.filter((d) => {
        const day = new Date(`${d}T00:00:00Z`).getUTCDay();
        return day !== 0 && day !== 6;
      });
    }

    if (serviceDates.length === 0) {
      setFieldErrors({ from: 'That range contains no dates' });
      return;
    }

    setSaving(true);
    try {
      const result = await apiClient.post<{
        created: number;
        updated: number;
        skipped: { reason: string }[];
      }>('/v1/vendor/availability', {
        mealId: String(f.get('mealId') ?? ''),
        kitchenId: String(f.get('kitchenId') ?? ''),
        serviceDates,
        timeSlotIds: [...selectedSlots],
        quantity: Number(f.get('quantity') ?? 0),
        ...(String(f.get('price') ?? '').trim() ? { price: String(f.get('price')) } : {}),
      });

      const parts = [`${result.created} created`, `${result.updated} updated`];
      if (result.skipped.length > 0) {
        parts.push(`${result.skipped.length} skipped (${result.skipped[0]?.reason})`);
      }
      setNotice(parts.join(', '));
      router.refresh();
    } catch (err) {
      const { fields, formError: message } = toFormErrors(err);
      setFieldErrors(fields);
      setFormError(message);
    } finally {
      setSaving(false);
    }
  }

  async function withdraw(id: string) {
    setFormError(null);
    setBusy(id);
    try {
      await apiClient.delete(`/v1/vendor/availability/${id}`);
      router.refresh();
    } catch (err) {
      const { formError: message, fields } = toFormErrors(err);
      setFormError(message ?? Object.values(fields)[0] ?? 'That date could not be withdrawn.');
    } finally {
      setBusy(null);
    }
  }

  const activeMeals = meals.filter((m) => m.isActive);

  // Group the schedule list by date so a vendor reads it as a calendar.
  const byDate = new Map<string, MealAvailability[]>();
  for (const row of availability) {
    const list = byDate.get(row.serviceDate);
    if (list) list.push(row);
    else byDate.set(row.serviceDate, [row]);
  }

  return (
    <div className="space-y-8">
      {formError && <Alert tone="error">{formError}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {!readOnly && (
        <form
          onSubmit={publish}
          noValidate
          className="space-y-5 rounded-lg border border-slate-200 bg-white p-5"
        >
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Publish a dish</h2>
            <p className="mt-1 text-sm text-slate-500">
              Pick a dish and the dates it should be on sale. Re-publishing a date updates it.
            </p>
          </div>

          {activeMeals.length === 0 ? (
            <Alert tone="warning">
              You have no active dishes. Add one on the Menu screen first.
            </Alert>
          ) : (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <SelectField
                  label="Dish"
                  name="mealId"
                  required
                  options={activeMeals.map((m) => ({
                    value: m.id,
                    label: `${m.name} · ${formatCurrency(m.basePrice)}`,
                  }))}
                  error={fieldErrors['mealId']}
                />
                <SelectField
                  label="Kitchen"
                  name="kitchenId"
                  required
                  options={kitchens.map((k) => ({ value: k.id, label: k.name }))}
                  error={fieldErrors['kitchenId']}
                />
                <TextField
                  label="From"
                  name="from"
                  type="date"
                  defaultValue={dateIso(1)}
                  min={dateIso(0)}
                  required
                  error={fieldErrors['from'] ?? fieldErrors['serviceDates']}
                />
                <TextField
                  label="To"
                  name="to"
                  type="date"
                  defaultValue={dateIso(7)}
                  min={dateIso(0)}
                  required
                  error={fieldErrors['to']}
                />
                <TextField
                  label="Quantity per day"
                  name="quantity"
                  type="number"
                  min={1}
                  defaultValue={20}
                  required
                  error={fieldErrors['quantity']}
                  hint="Capped by the dish's maximum daily quantity."
                />
                <TextField
                  label="Price override"
                  name="price"
                  inputMode="decimal"
                  placeholder="Leave blank to use the dish price"
                  error={fieldErrors['price']}
                />
              </div>

              <fieldset>
                <legend className="text-sm font-medium text-slate-900">Delivery times</legend>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {timeSlots.map((slot) => {
                    const checked = selectedSlots.has(slot.id);
                    return (
                      <li key={slot.id}>
                        <label
                          className={`inline-flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
                            checked
                              ? 'bg-brand-50 text-brand-700 ring-brand-300'
                              : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            onChange={() => {
                              const next = new Set(selectedSlots);
                              if (checked) next.delete(slot.id);
                              else next.add(slot.id);
                              setSelectedSlots(next);
                            }}
                          />
                          {slot.label}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {fieldErrors['timeSlotIds'] && (
                  <p role="alert" className="mt-2 text-sm text-red-600">
                    {fieldErrors['timeSlotIds']}
                  </p>
                )}
              </fieldset>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={skipWeekends}
                  onChange={(e) => setSkipWeekends(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                />
                Weekdays only
              </label>

              <div className="flex justify-end">
                <Button type="submit" loading={saving}>
                  {saving ? 'Publishing…' : 'Publish'}
                </Button>
              </div>
            </>
          )}
        </form>
      )}

      <section>
        <h2 className="text-sm font-semibold text-slate-900">Published dates</h2>
        {byDate.size === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="Nothing published yet"
              description="Publish a dish above and it becomes orderable for those dates."
            />
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            {[...byDate.entries()].map(([date, rows]) => (
              <div key={date} className="rounded-lg border border-slate-200 bg-white">
                <header className="border-b border-slate-100 px-4 py-2.5">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'short',
                      timeZone: 'UTC',
                    })}
                  </h3>
                </header>
                <ul className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900">{row.meal.name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {row.timeSlot.label} · {formatCurrency(row.price)} ·{' '}
                          {row.remaining} of {row.totalQuantity} left
                          {row.reservedQuantity > 0 && ` · ${row.reservedQuantity} sold`}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          row.status === 'PUBLISHED'
                            ? 'bg-green-50 text-green-700 ring-green-200'
                            : 'bg-slate-100 text-slate-600 ring-slate-200'
                        }`}
                      >
                        {row.status.charAt(0) + row.status.slice(1).toLowerCase()}
                      </span>
                      {!readOnly && row.status !== 'CANCELLED' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={busy === row.id}
                          onClick={() => withdraw(row.id)}
                        >
                          Withdraw
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
