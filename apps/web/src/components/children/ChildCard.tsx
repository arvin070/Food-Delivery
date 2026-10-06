'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Child } from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

const DIETARY_LABELS: Record<string, string> = {
  NONE: 'No restriction',
  VEGETARIAN: 'Vegetarian',
  VEGAN: 'Vegan',
  EGGETARIAN: 'Eggetarian',
  JAIN: 'Jain',
};

/** One child, with the detail a parent scans for and the two actions. */
export function ChildCard({ child }: { child: Child }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setError(null);
    setRemoving(true);
    try {
      await apiClient.delete(`/v1/children/${child.id}`);
      router.refresh();
    } catch (err) {
      // The API refuses while meals are still scheduled; show that reason.
      const { formError, fields } = toFormErrors(err);
      setError(formError ?? Object.values(fields)[0] ?? 'We could not remove this child.');
      setRemoving(false);
      setConfirming(false);
    }
  }

  const schoolLine = [child.institution?.name, child.grade, child.section && `Sec ${child.section}`]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">{child.fullName}</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            {child.age !== null ? `${child.age} years old` : 'Age not set'}
            {schoolLine && ` · ${schoolLine}`}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Link href={`/children/${child.id}/edit`}>
            <Button variant="secondary" size="sm">
              Edit
            </Button>
          </Link>
          {!confirming && (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
              Remove
            </Button>
          )}
        </div>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Detail label="Checkpoint" value={child.defaultCheckpoint?.name ?? 'Not set'} />
        <Detail label="Delivery time" value={child.defaultTimeSlot?.name ?? 'Not set'} />
        <Detail
          label="Diet"
          value={DIETARY_LABELS[child.dietaryPreference] ?? child.dietaryPreference}
        />
        <Detail label="Roll number" value={child.rollNumber ?? 'Not set'} />
      </dl>

      {child.allergies && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <span className="font-semibold">Allergies:</span> {child.allergies}
        </p>
      )}

      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {confirming && (
        <div className="mt-4 rounded-md bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
          <p className="text-sm text-slate-700">
            Remove <strong>{child.fullName}</strong>? Past orders are kept, and you can add them
            again later.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="danger" size="sm" loading={removing} onClick={remove}>
              {removing ? 'Removing…' : 'Yes, remove'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={removing}
              onClick={() => setConfirming(false)}
            >
              Keep
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-slate-500">{label}:</dt>
      <dd className="min-w-0 truncate font-medium text-slate-900">{value}</dd>
    </div>
  );
}
