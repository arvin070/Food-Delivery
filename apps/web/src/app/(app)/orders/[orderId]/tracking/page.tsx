import { CustomerTracking } from '@/components/tracking/CustomerTracking';
import { requireUser } from '@/lib/session';
export const metadata = { title: 'Track your meal' };
export default async function TrackingPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  await requireUser(`/orders/${orderId}/tracking`);
  return <CustomerTracking orderId={orderId} />;
}
