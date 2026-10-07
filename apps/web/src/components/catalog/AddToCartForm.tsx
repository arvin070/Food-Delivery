'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { Child } from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

export function AddToCartForm({
  mealScheduleId,
  checkpointId,
  children,
}: {
  mealScheduleId: string;
  checkpointId: string;
  children: Child[];
}) {
  const [quantity, setQuantity] = useState(1);
  const [childId, setChildId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setAdded(false);
    try {
      await apiClient.post('/v1/cart/items', {
        mealScheduleId,
        checkpointId,
        childId: childId || null,
        quantity,
        notes: notes || null,
      });
      setAdded(true);
    } catch (err) {
      const { formError, fields } = toFormErrors(err);
      setError(formError ?? Object.values(fields)[0] ?? 'Could not add this meal.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={add} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {added && (
        <Alert tone="success">
          Added to cart. <Link className="font-semibold underline" href="/cart">View cart</Link>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-900">
          Quantity
          <input
            className="mt-1.5 block w-full rounded-md border-0 py-2 px-3 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600"
            type="number"
            min={1}
            max={100}
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value))}
          />
        </label>
        <label className="block text-sm font-medium text-slate-900">
          Beneficiary
          <select
            className="mt-1.5 block w-full rounded-md border-0 py-2 px-3 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600"
            value={childId}
            onChange={(event) => setChildId(event.target.value)}
          >
            <option value="">Myself</option>
            {children.map((child) => (
              <option key={child.id} value={child.id}>{child.fullName}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm font-medium text-slate-900">
        Notes for the kitchen
        <textarea
          className="mt-1.5 block w-full rounded-md border-0 py-2 px-3 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600"
          rows={2}
          maxLength={500}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional"
        />
      </label>
      <Button type="submit" size="lg" loading={saving} className="w-full" disabled={!checkpointId}>
        {saving ? 'Adding…' : 'Add to cart'}
      </Button>
    </form>
  );
}