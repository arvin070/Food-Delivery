'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatCurrency, type CartView } from '@lunch/shared';
import { apiClient, ApiError } from '@/lib/api.client';
import { toFormErrors } from '@/lib/form';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

export function CartContents({ initialCart }: { initialCart: CartView }) {
  const router = useRouter();
  const [cart, setCart] = useState(initialCart);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutKey, setCheckoutKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const storageKey = `lunch.checkout.${initialCart.id}`;
  useEffect(() => {
    try { setCheckoutKey(sessionStorage.getItem(storageKey)); } catch { /* Storage may be disabled. */ }
  }, [storageKey]);
  function rememberCheckout(key: string | null) {
    setCheckoutKey(key);
    try { if (key) sessionStorage.setItem(storageKey, key); else sessionStorage.removeItem(storageKey); } catch { /* Keep the in-memory retry key. */ }
  }

  async function updateQuantity(itemId: string, quantity: number) {
    setBusyId(itemId);
    setError(null);
    try {
      const result = await apiClient.patch<{ cart: CartView }>(`/v1/cart/items/${itemId}`, { quantity });
      setCart(result.cart);
    } catch (err) {
      const { formError } = toFormErrors(err);
      setError(formError ?? 'Could not update quantity.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(itemId: string) {
    setBusyId(itemId);
    setError(null);
    try {
      await apiClient.delete(`/v1/cart/items/${itemId}`);
      const result = await apiClient.get<{ cart: CartView }>('/v1/cart');
      setCart(result.cart);
    } catch (err) {
      const { formError } = toFormErrors(err);
      setError(formError ?? 'Could not remove this meal.');
    } finally {
      setBusyId(null);
    }
  }

  async function checkout() {
    setCheckingOut(true);
    setError(null);
    try {
      const idempotencyKey = checkoutKey ?? crypto.randomUUID();
      if (!checkoutKey) rememberCheckout(idempotencyKey);
      const { order } = await apiClient.post<{ order: { id: string } }>('/v1/orders/checkout', {
        idempotencyKey,
      });
      rememberCheckout(null);
      router.push(`/orders/${order.id}`);
      router.refresh();
    } catch (err) {
      const { formError } = toFormErrors(err);
      setError(formError ?? 'Checkout could not be completed.');
      if (err instanceof ApiError && [400, 409, 422].includes(err.status)) rememberCheckout(null);
      setCheckingOut(false);
    }
  }

  if (checkoutKey && cart.items.length === 0) {
    return <section className="space-y-4 rounded-lg border p-6">
      <h2 className="text-lg font-semibold">Recover your checkout</h2>
      <p>The previous response was interrupted. Retrieve that order before starting another checkout.</p>
      {error && <Alert tone="error">{error}</Alert>}
      <Button loading={checkingOut} onClick={checkout}>Retry checkout</Button>
      <Link className="block text-brand-700" href="/orders">View order history</Link>
    </section>;
  }
  if (cart.items.length === 0) {
    return (
      <div className="border-y border-slate-200 py-14 text-center">
        <h2 className="text-lg font-semibold text-slate-900">Your cart is empty</h2>
        <p className="mt-1 text-sm text-slate-500">Choose a meal and delivery window to get started.</p>
        <Link href="/meals" className="mt-4 inline-flex text-sm font-semibold text-brand-700">Browse meals</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <section className="divide-y divide-slate-200 border-y border-slate-200">
        {error && <div className="py-3"><Alert tone="error">{error}</Alert></div>}
        {cart.items.map((item) => (
          <article key={item.id} className="grid gap-4 py-5 sm:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold text-slate-900">{item.mealName}</h2>
                <span className="font-semibold tabular-nums text-slate-900">{formatCurrency(item.lineTotal)}</span>
              </div>
              <p className="mt-1 text-sm text-slate-600">For {item.beneficiary.name} · {item.kitchen.name}</p>
              <p className="text-sm text-slate-500">{item.serviceDate} · {item.timeSlot.label} · {item.checkpoint.name}</p>
              {!item.orderable && <p className="mt-2 text-sm font-medium text-red-700">No longer available for this delivery. Remove it to continue.</p>}
              {item.notes && <p className="mt-1 text-sm text-slate-500">Note: {item.notes}</p>}
            </div>
            <div className="flex items-center gap-3 sm:justify-end">
              <label className="sr-only" htmlFor={`quantity-${item.id}`}>Quantity for {item.mealName}</label>
              <input
                id={`quantity-${item.id}`}
                className="w-20 rounded-md border-0 px-2 py-2 text-sm ring-1 ring-inset ring-slate-300"
                type="number"
                min={1}
                max={Math.min(100, item.remaining)}
                value={item.quantity}
                disabled={busyId !== null || checkingOut || !!checkoutKey}
                onChange={(event) => {
                  const quantity = Number(event.target.value);
                  if (Number.isInteger(quantity) && quantity >= 1) void updateQuantity(item.id, quantity);
                }}
              />
              <Button variant="ghost" size="sm" disabled={busyId !== null || checkingOut || !!checkoutKey} loading={busyId === item.id} onClick={() => remove(item.id)}>
                Remove
              </Button>
            </div>
          </article>
        ))}
      </section>

      <aside className="h-fit border-y border-slate-200 py-5">
        <h2 className="text-base font-semibold text-slate-900">Order summary</h2>
        <div className="mt-4 flex justify-between text-sm text-slate-600">
          <span>{cart.itemCount} meals</span>
          <span>{formatCurrency(cart.subtotal)}</span>
        </div>
        <div className="mt-4 flex justify-between border-t border-slate-200 pt-4 font-semibold text-slate-900">
          <span>Total</span><span>{formatCurrency(cart.subtotal)}</span>
        </div>
        <Button
          className="mt-5 w-full"
          size="lg"
          loading={checkingOut}
          disabled={busyId !== null || (!checkoutKey && cart.items.some((item) => !item.orderable))}
          onClick={checkout}
        >
          {checkingOut ? 'Placing order…' : checkoutKey ? 'Retry checkout' : 'Checkout'}
        </Button>
        <p className="mt-2 text-xs text-slate-500">Prices and availability are confirmed again at checkout.</p>
      </aside>
    </div>
  );
}