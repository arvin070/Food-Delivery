import { UserRole } from '@lunch/shared';
import { requireRole } from '@/lib/session';
import { AuditBrowser } from '@/components/admin-console/AdminConsole';
export const metadata = { title: 'Admin audit log' };
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  await requireRole([UserRole.SUPER_ADMIN], '/admin/audit');
  const { search } = await searchParams;
  return <AuditBrowser initialSearch={search ?? ''} />;
}
