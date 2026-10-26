import { requireUser } from '@/lib/session';
import { apiServer } from '@/lib/api.server';
import {
  SupportCenter,
  type ComplaintList,
} from '@/components/admin-console/SupportCenter';
export const metadata = { title: 'Help & complaints' };
export default async function SupportPage() {
  const user = await requireUser('/support');
  const [initial, orders] = await Promise.all([
    apiServer.get<ComplaintList>('/complaints'),
    ['CUSTOMER', 'PARENT', 'STUDENT'].includes(user.role)
      ? apiServer.get<{ id: string; orderNumber: string }[]>('/orders')
      : Promise.resolve([]),
  ]);
  return <SupportCenter initial={initial} orders={orders} />;
}
