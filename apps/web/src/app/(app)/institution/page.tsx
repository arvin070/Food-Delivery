import { UserRole, type InstitutionSummary } from '@lunch/shared';
import { requireRole } from '@/lib/session';
import { apiServer } from '@/lib/api.server';
import { InstitutionConsole } from '@/components/institutions/InstitutionConsole';
export const metadata = { title: 'Institution management' };
export default async function InstitutionPage() {
  const user = await requireRole(
    [UserRole.INSTITUTION_ADMIN, UserRole.SUPER_ADMIN],
    '/institution',
  );
  const initial = await apiServer.get<{
    items: InstitutionSummary[];
    total: number;
    page: number;
    pageSize: number;
  }>('/institutions');
  return (
    <InstitutionConsole
      initial={initial}
      superAdmin={user.role === 'SUPER_ADMIN'}
    />
  );
}
