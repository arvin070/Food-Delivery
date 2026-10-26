import { CustomerTracking } from '@/components/tracking/CustomerTracking';
import { requireUser } from '@/lib/session';
export const metadata = { title: 'Delivery tracking' };
export default async function TrackingPage() {
  await requireUser('/tracking');
  return <CustomerTracking />;
}
