'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { VendorStatus, type VendorSummary } from '@lunch/shared';
import { apiClient } from '@/lib/api.client';
import { toFormErrors, type FieldErrors } from '@/lib/form';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/States';

/** The status moves an admin can make from each state. */
const ACTIONS: Record<string, { to: VendorStatus; label: string; variant: 'primary' | 'danger' | 'secondary' }[]> = {
  PENDING_APPROVAL: [
    { to: VendorStatus.APPROVED, label: 'Approve', variant: 'primary' },
    { to: VendorStatus.REJECTED, label: 'Reject', variant: 'danger' },
  ],
  APPROVED: [{ to: VendorStatus.SUSPENDED, label: 'Suspend', variant: 'danger' }],
  SUSPENDED: [{ to: VendorStatus.APPROVED, label: 'Restore', variant: 'primary' }],
  REJECTED: [{ to: VendorStatus.APPROVED, label: 'Approve', variant: 'primary' }],
};

export function VendorAdminList({ vendors }: { vendors: VendorSummary[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function changeStatus(vendorId: string, status: VendorStatus) {
    setError(null);
    setBusy(vendorId);
    try {
      await apiClient.patch(`/v1/admin/vendors/${vendorId}/status`, { status });
      router.refresh();
    } catch (err) {
      const { formError, fields } = toFormErrors(err);
      setError(formError ?? Object.values(fields)[0] ?? 'That change was not accepted.');
    } finally {
      setBusy(null);
    }
  }

  async function createVendor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const f = new FormData(event.currentTarget);
    setBusy('new');
    try {
      await apiClient.post('/v1/admin/vendors', {
        ownerEmail: String(f.get('ownerEmail') ?? '').trim(),
        businessName: String(f.get('businessName') ?? '').trim(),
        commissionPct: Number(f.get('commissionPct') ?? 15),
      });
      setCreating(false);
      router.refresh();
    } catch (err) {
      const { formError, fields } = toFormErrors(err);
      setFieldErrors(fields);
      setError(formError);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex justify-end">
        {!creating && <Button onClick={() => setCreating(true)}>Create vendor</Button>}
      </div>

      {creating && (
        <form
          onSubmit={createVendor}
          noValidate
          className="space-y-5 rounded-lg border-2 border-brand-200 bg-brand-50/30 p-5"
        >
          <div>
            <h2 className="text-base font-semibold text-slate-900">Create a vendor</h2>
            <p className="mt-1 text-sm text-slate-500">
              The owner must already have a Lunch account — they are promoted to the vendor role.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              label="Owner email"
              name="ownerEmail"
              type="email"
              required
              autoFocus
              error={fieldErrors['ownerEmail']}
            />
            <TextField
              label="Business name"
              name="businessName"
              required
              error={fieldErrors['businessName']}
            />
            <TextField
              label="Commission %"
              name="commissionPct"
              type="number"
              min={0}
              max={100}
              step="0.01"
              defaultValue={15}
              error={fieldErrors['commissionPct']}
            />
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy === 'new'}>
              Create vendor
            </Button>
          </div>
        </form>
      )}

      {vendors.length === 0 ? (
        <EmptyState title="No vendors yet" description="Create the first vendor to get started." />
      ) : (
        <ul className="space-y-3">
          {vendors.map((vendor) => (
            <li key={vendor.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">
                      {vendor.businessName}
                    </h3>
                    <StatusBadge status={vendor.status} />
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {vendor.owner.fullName} · {vendor.owner.email ?? vendor.owner.phone}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {vendor.kitchenCount} {vendor.kitchenCount === 1 ? 'kitchen' : 'kitchens'} ·{' '}
                    {vendor.mealCount} {vendor.mealCount === 1 ? 'dish' : 'dishes'} ·{' '}
                    {vendor.commissionPct}% commission
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  {(ACTIONS[vendor.status] ?? []).map((action) => (
                    <Button
                      key={action.to}
                      variant={action.variant}
                      size="sm"
                      loading={busy === vendor.id}
                      onClick={() => changeStatus(vendor.id, action.to)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
