import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CustomerOrder } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { isApiError } from '@/lib/api-error';
import { requireUser } from '@/lib/session';
import { OrderDetails } from '@/components/orders/OrderDetails';

export const metadata: Metadata = { title: 'Order details' };

export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  await requireUser('/orders');
  const { orderId } = await params;
  try {
    const { order } = await apiServer.get<{ order: CustomerOrder }>(`/orders/${orderId}`);
    return <OrderDetails order={order} />;
  } catch (error) {
    if (isApiError(error) && error.status === 404) notFound();
    throw error;
  }
}