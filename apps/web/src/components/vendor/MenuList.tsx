'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatCurrency, type VendorMeal } from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

const FOOD_TYPE_LABELS: Record<string, string> = {
  VEG: 'Veg',
  NON_VEG: 'Non-veg',
  EGG: 'Egg',
  VEGAN: 'Vegan',
  JAIN: 'Jain',
};

export function MenuList({
  meals,
  readOnly,
  onEdit,
}: {
  meals: VendorMeal[];
  readOnly: boolean;
  onEdit: (meal: VendorMeal) => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleActive(meal: VendorMeal) {
    setError(null);
    setBusy(meal.id);
    try {
      await apiClient.patch(`/v1/vendor/meals/${meal.id}`, { isActive: !meal.isActive });
      router.refresh();
    } catch (err) {
      const { formError, fields } = toFormErrors(err);
      setError(formError ?? Object.values(fields)[0] ?? 'That change was not accepted.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(meal: VendorMeal) {
    setError(null);
    setBusy(meal.id);
    try {
      await apiClient.delete(`/v1/vendor/meals/${meal.id}`);
      setConfirming(null);
      router.refresh();
    } catch (err) {
      // The API refuses while orders are outstanding; show that reason.
      const { formError, fields } = toFormErrors(err);
      setError(formError ?? Object.values(fields)[0] ?? 'That meal could not be removed.');
      setConfirming(null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      <ul className="space-y-3">
        {meals.map((meal) => (
          <li key={meal.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-slate-900">{meal.name}</h3>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                    {FOOD_TYPE_LABELS[meal.foodType] ?? meal.foodType}
                  </span>
                  {!meal.isActive && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                      Inactive
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-slate-500">
                  {formatCurrency(meal.basePrice)} · {meal.prepTimeMinutes} min prep
                  {meal.scheduledCount > 0 && ` · published on ${meal.scheduledCount} dates`}
                </p>
                {meal.description && (
                  <p className="mt-1.5 text-sm text-slate-600">{meal.description}</p>
                )}
                {meal.components.length > 0 && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    {meal.components
                      .map((c) => (c.quantity ? `${c.name} (${c.quantity})` : c.name))
                      .join(' · ')}
                  </p>
                )}
              </div>

              {!readOnly && (
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => onEdit(meal)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === meal.id && confirming !== meal.id}
                    onClick={() => toggleActive(meal)}
                  >
                    {meal.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                  {confirming !== meal.id && (
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(meal.id)}>
                      Remove
                    </Button>
                  )}
                </div>
              )}
            </div>

            {confirming === meal.id && (
              <div className="mt-4 rounded-md bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
                <p className="text-sm text-slate-700">
                  Remove <strong>{meal.name}</strong>? Future publications are cancelled. Past
                  orders keep their record.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    loading={busy === meal.id}
                    onClick={() => remove(meal)}
                  >
                    Yes, remove
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setConfirming(null)}>
                    Keep
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
