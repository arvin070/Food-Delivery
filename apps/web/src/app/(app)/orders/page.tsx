import type { Metadata } from 'next';
import Link from 'next/link';
import { formatCurrency, UserRole, type CustomerOrder } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { requireRole } from '@/lib/session';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/States';

export const metadata: Metadata = { title: 'My orders' };

export default async function OrdersPage() {
  await requireRole(
    [UserRole.CUSTOMER, UserRole.PARENT, UserRole.STUDENT, UserRole.SUPER_ADMIN],
    '/orders'
  );
  const orders = await apiServer.get<CustomerOrder[]>('/orders?pageSize=50');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My orders</h1>
          <p className="mt-1 text-sm text-slate-500">Delivery progress and order history.</p>
        </div>
        <Link href="/cart" className="text-sm font-semibold text-brand-700">View cart</Link>
      </div>
      {orders.length === 0 ? (
        <EmptyState title="No orders yet" description="Your placed orders and delivery updates will appear here." action={<Link className="font-semibold text-brand-700" href="/meals">Browse meals</Link>} />
      ) : (
        <ul className="divide-y divide-slate-200 border-y border-slate-200">
          {orders.map((order) => (
            <li key={order.id}>
              <Link href={`/orders/${order.id}`} className="flex flex-wrap items-center justify-between gap-4 py-4 hover:bg-slate-50">
                <div>
                  <p className="font-semibold text-slate-900">{order.orderNumber}</p>
                  <p className="mt-1 text-sm text-slate-500">{order.items.length} items · Payment {order.paymentStatus.toLowerCase()}</p>
                  <p className="text-xs text-slate-500">{new Date(order.createdAt).toLocaleString('en-IN')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums text-slate-900">{formatCurrency(order.totalAmount)}</span>
                  <StatusBadge status={order.status.toLowerCase()} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
