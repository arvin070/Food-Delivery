import Link from 'next/link';
import { UserRole, type RouteOptions } from '@lunch/shared';
import { requireRole } from '@/lib/session';
import { apiServer } from '@/lib/api.server';
import { RouteEditor } from '@/components/routes/RouteManagement';
export const metadata = { title: 'Plan a route' };
export default async function NewRoutePage() {
  await requireRole([UserRole.SUPER_ADMIN], '/admin/routes/new');
  const options = await apiServer.get<RouteOptions>('/admin/routes/options');
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link className="inline-block py-2 text-emerald-700" href="/admin/routes">
        ← Delivery routes
      </Link>
      <RouteEditor options={options} date={date} />
    </div>
  );
}
