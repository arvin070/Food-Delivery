import { UserRole, type CorporateSummary } from '@lunch/shared';
import { requireRole } from '@/lib/session';
import { apiServer } from '@/lib/api.server';
import { CorporateConsole } from '@/components/corporate/CorporateConsole';
export const metadata = { title: 'Corporate meals' };
export default async function CorporatePage() {
  const user = await requireRole(
    [
      UserRole.CUSTOMER,
      UserRole.PARENT,
      UserRole.STUDENT,
      UserRole.SUPER_ADMIN,
    ],
    '/corporate',
  );
  const initial = await apiServer.get<{
    items: CorporateSummary[];
    page: number;
    pageSize: number;
    total: number;
  }>('/corporate');
  return (
    <CorporateConsole
      initial={initial}
      superAdmin={user.role === 'SUPER_ADMIN'}
    />
  );
}
