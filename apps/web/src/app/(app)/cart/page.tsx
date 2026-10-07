import type { Metadata } from 'next';
import { UserRole, type CartView } from '@lunch/shared';
import { apiServer } from '@/lib/api.server';
import { requireRole } from '@/lib/session';
import { CartContents } from '@/components/orders/CartContents';

export const metadata: Metadata = { title: 'Cart' };

export default async function CartPage() {
  await requireRole([UserRole.CUSTOMER, UserRole.PARENT, UserRole.STUDENT], '/cart');
  const { cart } = await apiServer.get<{ cart: CartView }>('/cart');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Your cart</h1>
        <p className="mt-1 text-sm text-slate-500">Review beneficiaries and delivery details before placing your order.</p>
      </div>
      <CartContents initialCart={cart} />
    </div>
  );
}