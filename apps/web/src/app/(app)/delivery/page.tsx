import type { Metadata } from 'next';
import { UserRole } from '@lunch/shared';
import { ModuleShell } from '@/components/ModuleShell';
import { plannedSectionsFor } from '@/lib/navigation';
import { requireRole } from '@/lib/session';

export const metadata: Metadata = { title: 'Deliveries' };

/** Delivery-partner surface. Admins can view it for support. */
export default async function DeliveryPage() {
  const user = await requireRole([UserRole.DELIVERY_PARTNER, UserRole.SUPER_ADMIN], '/delivery');

  return (
    <ModuleShell
      title="My deliveries"
      subtitle={`Signed in as ${user.fullName}. Assigned runs, checkpoint order and proof of delivery.`}
      moduleName="delivery module"
      sections={plannedSectionsFor(UserRole.DELIVERY_PARTNER)}
    />
  );
}
