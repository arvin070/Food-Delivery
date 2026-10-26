import { notFound } from 'next/navigation';
import {
  UserRole,
  adminResources,
  type AdminResource,
  type AdminDetail,
} from '@lunch/shared';
import { requireRole } from '@/lib/session';
import { apiServer } from '@/lib/api.server';
import { AdminRecordView } from '@/components/admin-console/AdminConsole';
export default async function RecordPage({
  params,
}: {
  params: Promise<{ resource: string; id: string }>;
}) {
  await requireRole([UserRole.SUPER_ADMIN], '/admin');
  const { resource, id } = await params;
  if (!adminResources.includes(resource as AdminResource)) notFound();
  const initial = await apiServer.get<AdminDetail>(
    '/admin/manage/' + resource + '/' + encodeURIComponent(id),
  );
  return (
    <AdminRecordView
      key={id}
      resource={resource as AdminResource}
      initial={initial}
    />
  );
}
