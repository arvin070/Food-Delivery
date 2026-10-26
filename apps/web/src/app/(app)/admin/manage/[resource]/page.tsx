import { notFound } from 'next/navigation';
import { UserRole, adminResources, type AdminResource } from '@lunch/shared';
import { requireRole } from '@/lib/session';
import { apiServer } from '@/lib/api.server';
import { AdminBrowser } from '@/components/admin-console/AdminConsole';
export default async function ManagePage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  await requireRole([UserRole.SUPER_ADMIN], '/admin');
  const { resource } = await params;
  if (!adminResources.includes(resource as AdminResource)) notFound();
  const { cities } = await apiServer.get<{
    cities: { id: string; name: string }[];
  }>('/admin/options');
  return (
    <AdminBrowser
      key={resource}
      resource={resource as AdminResource}
      cities={cities}
    />
  );
}
