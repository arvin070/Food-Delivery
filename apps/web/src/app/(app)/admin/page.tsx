import { UserRole, type AdminDashboard } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { requireRole } from '@/lib/session';
import { AdminHome } from '@/components/admin-console/AdminConsole';
export const metadata = { title: 'Super admin dashboard' };
export default async function AdminPage() {
  await requireRole([UserRole.SUPER_ADMIN], '/admin');
  return (
    <AdminHome
      initial={await apiServer.get<AdminDashboard>('/admin/dashboard')}
    />
  );
}
