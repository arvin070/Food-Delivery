import Link from 'next/link';
import { UserRole, type RouteOptions, type ManagedRoute } from '@lunch/shared';
import { requireRole } from '@/lib/session';
import { apiServer } from '@/lib/api.server';
import { RouteEditor, RouteSummary } from '@/components/routes/RouteManagement';
export const metadata = { title: 'Manage route' };
export default async function RoutePage({
  params,
}: {
  params: Promise<{ routeId: string }>;
}) {
  await requireRole([UserRole.SUPER_ADMIN], '/admin/routes');
  const { routeId } = await params;
  const [{ route }, options] = await Promise.all([
    apiServer.get<{ route: ManagedRoute }>(
      '/admin/routes/' + encodeURIComponent(routeId),
    ),
    apiServer.get<RouteOptions>('/admin/routes/options'),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link className="inline-block py-2 text-emerald-700" href="/admin/routes">
        ← Delivery routes
      </Link>
      <RouteSummary route={route} />
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Checkpoint batches</h2>
        {route.stops.map((s) => (
          <article key={s.id} className="rounded-xl border p-4">
            <h3 className="font-semibold">
              {s.sequence}. {s.name}
            </h3>
            <p className="text-sm text-slate-600">
              {s.meals} meals · {s.orders} orders · {s.status.toLowerCase()}
            </p>
            {s.instructions && <p className="my-2 text-sm">{s.instructions}</p>}
            <ul className="mt-2 divide-y">
              {s.batches.map((b) => (
                <li
                  key={b.mealId + ':' + b.timeSlotId}
                  className="py-2 text-sm"
                >
                  {b.timeSlot} — {b.mealName} —{' '}
                  <strong>{b.quantity} meals</strong>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
      <RouteEditor
        key={route.revision}
        options={options}
        date={route.date}
        route={route}
      />
    </div>
  );
}
