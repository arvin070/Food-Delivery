import type { Metadata } from 'next';
import Link from 'next/link';
import { UserRole, type VendorOrderItem } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { isApiError } from '@/lib/api-error';
import { requireRole } from '@/lib/session';
import { NoVendorProfile } from '@/components/vendor/NoVendorProfile';
import { OrderQueue } from '@/components/vendor/OrderQueue';

export const metadata: Metadata = { title: 'Order queue' };

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
];

export default async function VendorOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; serviceDate?: string; status?: string }>;
}) {
  const user = await requireRole([UserRole.VENDOR, UserRole.SUPER_ADMIN], '/vendor/orders');
  const { range = 'today', serviceDate, status } = await searchParams;

  const params = new URLSearchParams({ range, pageSize: '100' });
  if (serviceDate) params.set('serviceDate', serviceDate);
  if (status) params.set('status', status);

  // `apiServer` unwraps the `data` envelope, so this is the array itself.
  let items: VendorOrderItem[];
  try {
    items = await apiServer.get<VendorOrderItem[]>(`/vendor/orders?${params.toString()}`);
  } catch (err) {
    if (isApiError(err) && err.status === 404) {
      return <NoVendorProfile isAdmin={user.role === UserRole.SUPER_ADMIN} />;
    }
    throw err;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/vendor" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Order queue</h1>
        <p className="mt-1 text-sm text-slate-500">
          Grouped by delivery slot and checkpoint — the order the kitchen works in.
        </p>
      </div>

      <nav aria-label="Date range" className="flex flex-wrap gap-2">
        {RANGES.map((option) => {
          const active = range === option.value && !serviceDate;
          return (
            <Link
              key={option.value}
              href={`/vendor/orders?range=${option.value}`}
              aria-current={active ? 'page' : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
                active
                  ? 'bg-brand-50 text-brand-700 ring-brand-200'
                  : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              {option.label}
            </Link>
          );
        })}
        {serviceDate && (
          <span className="rounded-md bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
            {serviceDate}
          </span>
        )}
      </nav>

      <OrderQueue items={items} />
    </div>
  );
}
