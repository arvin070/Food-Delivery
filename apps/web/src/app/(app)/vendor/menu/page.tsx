import type { Metadata } from 'next';
import Link from 'next/link';
import { UserRole, type VendorMeal } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { isApiError } from '@/lib/api-error';
import { requireRole } from '@/lib/session';
import { NoVendorProfile } from '@/components/vendor/NoVendorProfile';
import { MenuManager } from '@/components/vendor/MenuManager';
import { Alert } from '@/components/ui/Alert';

export const metadata: Metadata = { title: 'Menu' };

export default async function VendorMenuPage() {
  const user = await requireRole([UserRole.VENDOR, UserRole.SUPER_ADMIN], '/vendor/menu');

  // `apiServer` unwraps the `data` envelope, so a paginated response yields
  // the array directly.
  let meals: VendorMeal[];
  let vendor: { status: string };
  let categories: { id: string; name: string }[];
  try {
    const [mealResult, profileResult, categoryResult] = await Promise.all([
      apiServer.get<VendorMeal[]>('/vendor/meals?pageSize=100'),
      apiServer.get<{ vendor: { status: string } }>('/vendor/profile'),
      apiServer.get<{ categories: { id: string; name: string }[] }>('/reference/meal-categories'),
    ]);
    meals = mealResult;
    vendor = profileResult.vendor;
    categories = categoryResult.categories;
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
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Menu</h1>
        <p className="mt-1 text-sm text-slate-500">
          The dishes you offer. Publishing them for specific dates comes with the catalog module.
        </p>
      </div>

      {readOnly && (
        <Alert tone="warning" title="Read-only">
          Your vendor account is not approved yet, so the menu cannot be changed.
        </Alert>
      )}

      <MenuManager meals={meals} categories={categories} readOnly={readOnly} />
    </div>
  );
}
