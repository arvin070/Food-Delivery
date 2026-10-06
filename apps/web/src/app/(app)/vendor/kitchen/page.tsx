import type { Metadata } from 'next';
import Link from 'next/link';
import { UserRole, type KitchenDetail } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { isApiError } from '@/lib/api-error';
import { requireRole } from '@/lib/session';
import { NoVendorProfile } from '@/components/vendor/NoVendorProfile';
import { KitchenForm } from '@/components/vendor/KitchenForm';
import { Alert } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/States';

export const metadata: Metadata = { title: 'Kitchen profile' };

interface CheckpointRow {
  id: string;
  name: string;
}

export default async function VendorKitchenPage() {
  const user = await requireRole([UserRole.VENDOR, UserRole.SUPER_ADMIN], '/vendor/kitchen');

  let kitchens: KitchenDetail[];
  let vendor: { status: string };
  let checkpoints: CheckpointRow[];
  try {
    const [kitchenResult, profileResult, checkpointResult] = await Promise.all([
      apiServer.get<{ kitchens: KitchenDetail[] }>('/vendor/kitchens'),
      apiServer.get<{ vendor: { status: string } }>('/vendor/profile'),
      apiServer.get<{ checkpoints: CheckpointRow[] }>('/reference/checkpoints'),
    ]);
    kitchens = kitchenResult.kitchens;
    vendor = profileResult.vendor;
    checkpoints = checkpointResult.checkpoints;
  } catch (err) {
    if (isApiError(err) && err.status === 404) {
      return <NoVendorProfile isAdmin={user.role === UserRole.SUPER_ADMIN} />;
    }
    throw err;
  }

  const readOnly = vendor.status !== 'APPROVED';

  return (
    <div className="space-y-6">
      <div>
        <Link href="/vendor" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
          Kitchen profile
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Address, contact, operating hours, capacity and the areas you deliver to.
        </p>
      </div>

      {readOnly && (
        <Alert tone="warning" title="Read-only">
          Your vendor account is not approved yet, so these details cannot be changed.
        </Alert>
      )}

      {kitchens.length === 0 ? (
        <EmptyState
          title="No kitchen set up yet"
          description="An administrator creates your first kitchen when your vendor account is approved."
        />
      ) : (
        <div className="space-y-10">
          {kitchens.map((kitchen) => (
            <KitchenForm
              key={kitchen.id}
              kitchen={kitchen}
              checkpoints={checkpoints}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </div>
  );
}
