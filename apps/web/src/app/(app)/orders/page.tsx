import type { Metadata } from 'next';
import { UserRole } from '@lunch/shared';
import { ModuleShell } from '@/components/ModuleShell';
import { plannedSectionsFor } from '@/lib/navigation';
import { requireRole } from '@/lib/session';

export const metadata: Metadata = { title: 'My orders' };

export default async function OrdersPage() {
  await requireRole(
    [UserRole.CUSTOMER, UserRole.PARENT, UserRole.STUDENT, UserRole.SUPER_ADMIN],
    '/orders'
  );

  return (
    <ModuleShell
      title="My orders"
      subtitle="Upcoming deliveries, live status and past orders."
      moduleName="orders module"
      sections={plannedSectionsFor(UserRole.CUSTOMER)}
    />
  );
}
