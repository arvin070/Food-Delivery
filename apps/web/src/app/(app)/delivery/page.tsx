import type { Metadata } from 'next';
import { UserRole } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { requireRole } from '@/lib/session';
import { DeliveryQueue, type DeliveryQueueItem } from '@/components/delivery/DeliveryQueue';

export const metadata: Metadata = { title: 'Deliveries' };

/** Delivery-partner surface. Admins can view it for support. */
export default async function DeliveryPage() {
  const user = await requireRole([UserRole.DELIVERY_PARTNER, UserRole.SUPER_ADMIN], '/delivery');

  const { deliveries } = await apiServer.get<{ deliveries: DeliveryQueueItem[] }>('/delivery/items');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My deliveries</h1>
        <p className="mt-1 text-sm text-slate-500">Signed in as {user.fullName}. Checkpoint assignments and handover progress.</p>
      </div>
      <DeliveryQueue deliveries={deliveries} />
    </div>
  );
}
