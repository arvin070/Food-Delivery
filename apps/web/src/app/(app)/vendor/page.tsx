import type { Metadata } from 'next';
import { UserRole } from '@lunch/shared';
import { ModuleShell } from '@/components/ModuleShell';
import { plannedSectionsFor } from '@/lib/navigation';
import { requireRole } from '@/lib/session';

export const metadata: Metadata = { title: 'Kitchen' };

/** Vendor surface. Admins can view it for support. */
export default async function VendorPage() {
  const user = await requireRole([UserRole.VENDOR, UserRole.SUPER_ADMIN], '/vendor');

  return (
    <ModuleShell
      title="Kitchen"
      subtitle={`Signed in as ${user.fullName}. Production queue, menu and order status.`}
      moduleName="vendor module"
      sections={plannedSectionsFor(UserRole.VENDOR)}
    />
  );
}
