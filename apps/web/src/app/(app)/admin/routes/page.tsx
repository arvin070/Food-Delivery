import { UserRole, type RouteOptions } from '@lunch/shared';
import { requireRole } from '@/lib/session';
import { apiServer } from '@/lib/api.server';
import { RouteList } from '@/components/routes/RouteManagement';
export const metadata = { title: 'Delivery routes' };
export default async function RoutesPage() {
  await requireRole([UserRole.SUPER_ADMIN], '/admin/routes');
  const options = await apiServer.get<RouteOptions>('/admin/routes/options');
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return <RouteList options={options} date={date} />;
}
