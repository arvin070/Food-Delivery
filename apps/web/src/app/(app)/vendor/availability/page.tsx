import type { Metadata } from 'next';
import Link from 'next/link';
import { UserRole, type KitchenDetail, type MealAvailability, type VendorMeal } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { isApiError } from '@/lib/api-error';
import { requireRole } from '@/lib/session';
import { AvailabilityManager } from '@/components/vendor/AvailabilityManager';
import { NoVendorProfile } from '@/components/vendor/NoVendorProfile';
import { Alert } from '@/components/ui/Alert';

export const metadata: Metadata = { title: 'Availability' };

/** `YYYY-MM-DD`, `offset` days from today. */
function dateIso(offset: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export default async function VendorAvailabilityPage() {
  const user = await requireRole([UserRole.VENDOR, UserRole.SUPER_ADMIN], '/vendor/availability');

  let meals: VendorMeal[];
  let kitchens: KitchenDetail[];
  let availability: MealAvailability[];
  let vendor: { status: string };
  let timeSlots: { id: string; label: string }[];

  try {
    const [mealResult, kitchenResult, availabilityResult, profileResult, slotResult] =
      await Promise.all([
        apiServer.get<VendorMeal[]>('/vendor/meals?pageSize=100'),
        apiServer.get<{ kitchens: KitchenDetail[] }>('/vendor/kitchens'),
        apiServer.get<MealAvailability[]>(
          `/vendor/availability?from=${dateIso(0)}&to=${dateIso(21)}&pageSize=100`
        ),
        apiServer.get<{ vendor: { status: string } }>('/vendor/profile'),
        apiServer.get<{ timeSlots: { id: string; label: string }[] }>('/reference/time-slots'),
      ]);
    meals = mealResult;
    kitchens = kitchenResult.kitchens;
    availability = availabilityResult;
    vendor = profileResult.vendor;
    timeSlots = slotResult.timeSlots;
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
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Availability</h1>
        <p className="mt-1 text-sm text-slate-500">
          A dish only becomes orderable once you publish it for a date and a delivery time.
        </p>
      </div>

      {readOnly && (
        <Alert tone="warning" title="Read-only">
          Your vendor account is not approved yet, so availability cannot be changed.
        </Alert>
      )}

      <AvailabilityManager
        meals={meals}
        kitchens={kitchens.map((k) => ({ id: k.id, name: k.name }))}
        timeSlots={timeSlots}
        availability={availability}
        readOnly={readOnly}
      />
    </div>
  );
}
