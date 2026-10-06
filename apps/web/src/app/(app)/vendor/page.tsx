import type { Metadata } from 'next';
import Link from 'next/link';
import { UserRole, formatCurrency, type VendorDashboard } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { isApiError } from '@/lib/api-error';
import { requireRole } from '@/lib/session';
import { NoVendorProfile } from '@/components/vendor/NoVendorProfile';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CapacityBar, Stat } from '@/components/ui/Stat';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/States';

export const metadata: Metadata = { title: 'Kitchen dashboard' };

/** "2026-10-08" → "Thu 8 Oct". */
function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export default async function VendorDashboardPage() {
  const user = await requireRole([UserRole.VENDOR, UserRole.SUPER_ADMIN], '/vendor');

  // An admin has no vendor of their own, so the API answers 404 here. That is
  // an expected state, not a failure — show them the way to the vendor list.
  let dashboard: VendorDashboard;
  try {
    ({ dashboard } = await apiServer.get<{ dashboard: VendorDashboard }>('/vendor/dashboard'));
  } catch (err) {
    if (isApiError(err) && err.status === 404) {
      return <NoVendorProfile isAdmin={user.role === UserRole.SUPER_ADMIN} />;
    }
    throw err;
  }

  const { today, upcoming, revenue, slotLoad, vendor } = dashboard;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {vendor.businessName}
            </h1>
            <StatusBadge status={vendor.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">Today, {formatDate(today.date)}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/vendor/orders">
            <Button>View order queue</Button>
          </Link>
        </div>
      </div>

      {vendor.status !== 'APPROVED' && (
        <Alert tone="warning" title="Your account is not live">
          {vendor.status === 'PENDING_APPROVAL'
            ? 'An administrator is reviewing your application. You can look around, but changes are disabled until it is approved.'
            : 'Your vendor account is not active, so changes are disabled. Contact support to restore it.'}
        </Alert>
      )}

      <section>
        <h2 className="text-sm font-semibold text-slate-900">Today</h2>
        <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Orders today" value={today.totalOrders} />
          <Stat
            label="Meals to prepare"
            value={today.toPrepare}
            tone={today.toPrepare > 0 ? 'warning' : 'default'}
            hint="Pending, confirmed and preparing"
          />
          <Stat label="Packed" value={today.packed} tone="brand" hint="Ready for collection" />
          <Stat label="Delivered" value={today.delivered} tone="success" />
        </dl>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Revenue</h2>
          <dl className="mt-3 grid gap-4 sm:grid-cols-2">
            <Stat
              label="Today (gross)"
              value={formatCurrency(revenue.today, revenue.currency)}
              hint={`After ${revenue.commissionPct}% commission: ${formatCurrency(
                revenue.todayNet,
                revenue.currency
              )}`}
            />
            <Stat
              label="Last 7 days"
              value={formatCurrency(revenue.last7Days, revenue.currency)}
              hint={`Last 30 days: ${formatCurrency(revenue.last30Days, revenue.currency)}`}
            />
          </dl>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-slate-900">Load by time slot</h2>
          <p className="mt-1 text-sm text-slate-500">Today’s meals against kitchen capacity.</p>
          <div className="mt-3 space-y-4 rounded-lg border border-slate-200 bg-white p-4">
            {slotLoad.length === 0 ? (
              <p className="text-sm text-slate-500">No slots configured.</p>
            ) : (
              slotLoad.map((slot) => (
                <CapacityBar
                  key={slot.timeSlotId}
                  label={slot.label}
                  used={slot.ordered}
                  total={slot.capacity}
                />
              ))
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Upcoming</h2>
          <span className="text-sm text-slate-500">{upcoming.totalOrders} orders booked</span>
        </div>
        {upcoming.byDate.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="Nothing booked yet"
              description="Orders for future dates will appear here as customers place them."
            />
          </div>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {upcoming.byDate.map((day) => (
              <li key={day.date}>
                <Link
                  href={`/vendor/orders?range=date&serviceDate=${day.date}`}
                  className="block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm"
                >
                  <p className="text-sm font-medium text-slate-900">{formatDate(day.date)}</p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {day.count} {day.count === 1 ? 'order' : 'orders'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
