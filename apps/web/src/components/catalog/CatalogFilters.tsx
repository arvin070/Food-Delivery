'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import {
  ALLERGEN_LABELS,
  Allergen,
  FOOD_TYPE_LABELS,
  MEAL_PERIOD_LABELS,
  type CatalogFacets,
  type DeliverySlotOption,
} from '@lunch/shared';

/**
 * Browse filters.
 *
 * State lives in the URL rather than React state, so a filtered view can be
 * shared or reloaded, and the server component re-fetches with the new query.
 */
export function CatalogFilters({
  institutions,
  facets,
  dates,
  checkpoints,
  deliverySlots,
}: {
  institutions: {id:string;name:string}[];
  facets: CatalogFacets;
  dates: string[];
  checkpoints: { id: string; name: string }[];
  deliverySlots: DeliverySlotOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      if (key === 'institutionId') { next.delete('checkpointId'); next.delete('timeSlotId'); }
      if (key === 'serviceDate' || key === 'checkpointId') next.delete('timeSlotId');
      next.delete('page');
      startTransition(() => router.push(`${pathname}?${next.toString()}`));
    },
    [params, pathname, router]
  );

  const toggleAllergen = useCallback(
    (allergen: string) => {
      const next = new URLSearchParams(params.toString());
      const current = next.getAll('excludeAllergens');
      next.delete('excludeAllergens');
      const updated = current.includes(allergen)
        ? current.filter((a) => a !== allergen)
        : [...current, allergen];
      for (const a of updated) next.append('excludeAllergens', a);
      next.delete('page');
      startTransition(() => router.push(`${pathname}?${next.toString()}`));
    },
    [params, pathname, router]
  );

  const excluded = params.getAll('excludeAllergens');
  const queryDate = params.get('serviceDate');
  const selectedDate = dates.includes(queryDate ?? '') ? queryDate! : dates[0] ?? '';
  const queryCheckpoint = params.get('checkpointId');
  const selectedCheckpoint = checkpoints.some((checkpoint) => checkpoint.id === queryCheckpoint)
    ? queryCheckpoint!
    : '';
  const queryTimeSlot = params.get('timeSlotId');
  const selectedTimeSlot = deliverySlots.some((slot) => slot.timeSlotId === queryTimeSlot)
    ? queryTimeSlot!
    : '';
  const selectClass =
    'w-full rounded-md border-0 py-2 pl-3 pr-8 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600';

  return (
    <fieldset disabled={isPending} aria-busy={isPending} className="space-y-5 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <label htmlFor="f-date" className="block text-sm font-medium text-slate-900">
          Delivery date
        </label>
        <select
          id="f-date"
          className={`mt-1.5 ${selectClass}`}
          value={selectedDate}
          onChange={(e) => setParam('serviceDate', e.target.value)}
        >
          <option value="">Select a date</option>
          {dates.map((d) => (
            <option key={d} value={d}>
              {new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                timeZone: 'UTC',
              })}
            </option>
          ))}
        </select>
      </div>

      <div><label htmlFor="f-institution" className="block text-sm font-medium text-slate-900">Institution (optional)</label><select id="f-institution" className={`mt-1.5 ${selectClass}`} value={params.get('institutionId')??''} onChange={e=>setParam('institutionId',e.target.value)}><option value="">All institutions & public checkpoints</option>{institutions.map(i=><option value={i.id} key={i.id}>{i.name}</option>)}</select></div>
      <div>
        <label htmlFor="f-checkpoint" className="block text-sm font-medium text-slate-900">
          Deliver to
        </label>
        <select
          id="f-checkpoint"
          className={`mt-1.5 ${selectClass}`}
          value={selectedCheckpoint}
          onChange={(e) => setParam('checkpointId', e.target.value)}
        >
          <option value="">Select a checkpoint</option>
          {checkpoints.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="f-time-slot" className="block text-sm font-medium text-slate-900">
          Delivery time
        </label>
        <select
          id="f-time-slot"
          className={`mt-1.5 ${selectClass}`}
          value={selectedTimeSlot}
          onChange={(e) => setParam('timeSlotId', e.target.value)}
          disabled={!selectedCheckpoint || !deliverySlots.length}
        >
          <option value="">Select an available time</option>
          {deliverySlots.map((slot) => (
            <option key={slot.timeSlotId} value={slot.timeSlotId} disabled={!slot.orderable}>
              {slot.label} · {formatSlotTime(slot.startMinute)}–{formatSlotTime(slot.endMinute)}
              {slot.remainingOrders !== null ? ` · ${slot.remainingOrders} left` : ''}
              {!slot.orderable && slot.remainingOrders === 0 ? ' · Full' : ''}
            </option>
          ))}
        </select>
        {selectedCheckpoint && deliverySlots.length === 0 && (
          <p className="mt-1 text-xs text-slate-500">No active delivery windows for this date.</p>
        )}
      </div>

      <div>
        <label htmlFor="f-period" className="block text-sm font-medium text-slate-900">
          Meal
        </label>
        <select
          id="f-period"
          className={`mt-1.5 ${selectClass}`}
          value={params.get('mealPeriod') ?? ''}
          onChange={(e) => setParam('mealPeriod', e.target.value)}
        >
          <option value="">Any time of day</option>
          {facets.mealPeriods.map((p) => (
            <option key={p.value} value={p.value}>
              {MEAL_PERIOD_LABELS[p.value] ?? p.value} ({p.count})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="f-foodtype" className="block text-sm font-medium text-slate-900">
          Diet
        </label>
        <select
          id="f-foodtype"
          className={`mt-1.5 ${selectClass}`}
          value={params.get('foodType') ?? ''}
          onChange={(e) => setParam('foodType', e.target.value)}
        >
          <option value="">Any</option>
          {facets.foodTypes.map((f) => (
            <option key={f.value} value={f.value}>
              {FOOD_TYPE_LABELS[f.value] ?? f.value} ({f.count})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="f-sort" className="block text-sm font-medium text-slate-900">
          Sort by
        </label>
        <select
          id="f-sort"
          className={`mt-1.5 ${selectClass}`}
          value={params.get('sort') ?? 'name'}
          onChange={(e) => setParam('sort', e.target.value)}
        >
          <option value="name">Delivery time</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
          <option value="popular">Most ordered</option>
        </select>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-slate-900">Hide meals containing</legend>
        <p className="mt-1 text-xs text-slate-500">
          Declared allergens only. Check with the kitchen for severe allergies.
        </p>
        <ul className="mt-2 space-y-1">
          {Object.values(Allergen).map((allergen) => (
            <li key={allergen}>
              <label className="flex items-center gap-2 rounded px-1 py-1 text-sm text-slate-700 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={excluded.includes(allergen)}
                  onChange={() => toggleAllergen(allergen)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                />
                {ALLERGEN_LABELS[allergen]}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    </fieldset>
  );
}

function formatSlotTime(minutes: number): string {
  const hour24 = Math.floor(minutes / 60);
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minutes % 60).padStart(2, '0')} ${hour24 < 12 ? 'AM' : 'PM'}`;
}
